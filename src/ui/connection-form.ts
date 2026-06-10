import { BoxRenderable, TextRenderable } from "@opentui/core";
import type { CliRenderer, KeyEvent, RenderContext } from "@opentui/core";
import type { ConnectionConfig } from "../types/connection.js";

// ─── Public API ───────────────────────────────────────────────

export interface FormAPI {
  /** Returns the form data as a ConnectionConfig, or null if invalid */
  getFormData(): ConnectionConfig | null;
  /** Returns an array of validation error messages (empty = valid) */
  validate(): string[];
  /** Register a callback for form submission */
  onSubmit(cb: (data: ConnectionConfig) => void): void;
  /** Register a callback for cancellation */
  onCancel(cb: () => void): void;
  /** Register a callback for deletion (only fires when editing) */
  onDelete(cb: (id: string) => void): void;
  /** Focus the first form field */
  focus(): void;
  /** Remove the form from the renderer and clean up */
  destroy(): void;
}

// ─── Design tokens ────────────────────────────────────────────
// Industrial-cyberpunk palette — dark, high-contrast, amber accents
const C = {
  overlayBg: "#000000b3", // black at ~70% opacity
  surfaceBg: "#16171a",
  surfaceBorder: "#27282d",
  titleFg: "#f59f00",
  labelFg: "#909296",
  fieldBg: "#1e1f24",
  fieldBorder: "#373a40",
  fieldFocusedBorder: "#f59f00",
  fieldText: "#e4e5e7",
  btnDefault: "#909296",
  btnSave: "#51cf66",
  btnDanger: "#ff6b6b",
  authActive: "#f59f00",
  authInactive: "#5c5f66",
  dialogWidth: 58,
} as const;

// ─── Helpers ──────────────────────────────────────────────────

function maskPassword(pw: string): string {
  return pw ? "•".repeat(pw.length) : " ";
}

// ─── State shape ──────────────────────────────────────────────

interface FormState {
  name: string;
  host: string;
  port: string;
  username: string;
  authType: "key" | "password";
  privateKeyPath: string;
  password: string;
}

// ─── Factory ──────────────────────────────────────────────────

export function createConnectionForm(
  renderer: CliRenderer,
  existing?: ConnectionConfig,
): BoxRenderable & FormAPI {
  const ctx = renderer as unknown as RenderContext;

  // ── State ──────────────────────────────────────────────
  const state: FormState = {
    name: existing?.name ?? "",
    host: existing?.host ?? "",
    port: existing?.port?.toString() ?? "22",
    username: existing?.username ?? "",
    authType: existing?.authType ?? "key",
    privateKeyPath: existing?.privateKeyPath ?? "~/.ssh/id_ed25519",
    password: existing?.password ?? "",
  };

  // ── Callbacks ──────────────────────────────────────────
  let onSubmitCb: ((data: ConnectionConfig) => void) | null = null;
  let onCancelCb: (() => void) | null = null;
  let onDeleteCb: ((id: string) => void) | null = null;

  let hasFocus = false;
  let focusedField = 0;

  // ── Renderable references (stored for direct updates) ──

  // Text-input fields: 0=name, 1=host, 2=port, 3=username
  const fieldBoxes: BoxRenderable[] = [];
  const fieldTexts: TextRenderable[] = [];
  const fieldLabels: TextRenderable[] = [];

  // Auth toggle
  let authKeyText: TextRenderable;
  let authPassText: TextRenderable;

  // Conditional field (key path | password)
  let conditionalLabel: TextRenderable;
  let conditionalText: TextRenderable;
  let conditionalBox: BoxRenderable;

  // Buttons
  let saveBtnText: TextRenderable;
  let cancelBtnText: TextRenderable;
  let deleteBtnText: TextRenderable | null = null;
  let deleteBtnBox: BoxRenderable | null = null;

  // ── Key handler ────────────────────────────────────────
  function handleKeyDown(key: KeyEvent) {
    if (!hasFocus) return;

    if (key.name === "escape") {
      key.preventDefault();
      if (onCancelCb) onCancelCb();
      return;
    }

    if (key.name === "tab") {
      key.preventDefault();
      const dir = key.shift ? -1 : 1;
      const total = getTotalFields();
      focusedField = ((focusedField + dir) % total + total) % total;
      updateFocusIndicators();
      return;
    }

    if (key.name === "enter" || key.name === "return") {
      key.preventDefault();
      handleSubmit();
      return;
    }

    // Arrow keys for auth toggle (field index 4)
    if ((key.name === "left" || key.name === "right") && focusedField === 4) {
      key.preventDefault();
      state.authType = key.name === "left" ? "key" : "password";
      refreshAuthToggle();
      refreshConditional();
      return;
    }

    // Backspace
    if (key.name === "backspace") {
      key.preventDefault();
      const idx = mapFocusToTextIndex(focusedField);
      if (idx >= 0) {
        const k = getStateKey(idx);
        state[k] = (state[k] as string).slice(0, -1) as never;
        refreshTextField(idx);
      } else if (focusedField === 5) {
        if (state.authType === "key") {
          state.privateKeyPath = state.privateKeyPath.slice(0, -1);
          conditionalText.content = state.privateKeyPath || " ";
        } else {
          state.password = state.password.slice(0, -1);
          conditionalText.content = maskPassword(state.password);
        }
      }
      return;
    }

    // Delete
    if (key.name === "delete") {
      key.preventDefault();
      const idx = mapFocusToTextIndex(focusedField);
      if (idx >= 0) {
        const k = getStateKey(idx);
        state[k] = (state[k] as string).slice(1) as never;
        refreshTextField(idx);
      } else if (focusedField === 5) {
        if (state.authType === "key") {
          state.privateKeyPath = state.privateKeyPath.slice(1);
          conditionalText.content = state.privateKeyPath || " ";
        } else {
          state.password = state.password.slice(1);
          conditionalText.content = maskPassword(state.password);
        }
      }
      return;
    }

    // Printable character input
    if (key.name.length === 1 && !key.ctrl && !key.meta && !key.option) {
      key.preventDefault();
      const idx = mapFocusToTextIndex(focusedField);
      if (idx >= 0) {
        const k = getStateKey(idx);
        state[k] = ((state[k] as string) + key.name) as never;
        refreshTextField(idx);
      } else if (focusedField === 5) {
        if (state.authType === "key") {
          state.privateKeyPath += key.name;
          conditionalText.content = state.privateKeyPath;
        } else {
          state.password += key.name;
          conditionalText.content = maskPassword(state.password);
        }
      }
      return;
    }
  }

  // ── Build UI tree ──────────────────────────────────────

  const overlay = new BoxRenderable(ctx, {
    id: "conn-form-overlay",
    position: "absolute",
    top: 0,
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: C.overlayBg,
    alignItems: "center",
    justifyContent: "center",
    focusable: true,
    onKeyDown: handleKeyDown,
  });

  const dialog = new BoxRenderable(ctx, {
    id: "conn-form-dialog",
    flexDirection: "column",
    border: true,
    borderColor: C.surfaceBorder,
    backgroundColor: C.surfaceBg,
    minWidth: C.dialogWidth,
    padding: 1,
    title: existing ? "  Edit Connection  " : "  New Connection  ",
    titleColor: C.titleFg,
    titleAlignment: "center",
  });

  overlay.add(dialog);

  const body = new BoxRenderable(ctx, {
    id: "conn-form-body",
    flexDirection: "column",
    paddingX: 1,
  });
  dialog.add(body);

  // ── Text fields ────────────────────────────────────────
  interface TextFieldDef {
    key: string;
    label: string;
  }
  const textFieldDefs: TextFieldDef[] = [
    { key: "name", label: "Name" },
    { key: "host", label: "Host" },
    { key: "port", label: "Port" },
    { key: "username", label: "Username" },
  ];

  for (const fd of textFieldDefs) {
    const lbl = new TextRenderable(ctx, {
      content: fd.label,
      fg: C.labelFg,
    });
    fieldLabels.push(lbl);

    const val = new TextRenderable(ctx, {
      content: getInitialText(fd.key),
      fg: C.fieldText,
    });
    fieldTexts.push(val);

    const inp = new BoxRenderable(ctx, {
      border: true,
      borderColor: C.fieldBorder,
      backgroundColor: C.fieldBg,
      paddingX: 1,
      paddingY: 0,
    });
    inp.add(val);
    fieldBoxes.push(inp);

    body.add(lbl);
    body.add(inp);
  }

  function getInitialText(key: string): string {
    const s = state as unknown as Record<string, string>;
    const v = s[key];
    if (v) return v;
    if (key === "port") return "22";
    return " ";
  }

  // ── Auth toggle ────────────────────────────────────────
  const authLabel = new TextRenderable(ctx, {
    content: "Auth Type",
    fg: C.labelFg,
  });
  body.add(authLabel);

  authKeyText = new TextRenderable(ctx, {
    content: " ● Key ",
    fg: C.authActive,
  });
  authPassText = new TextRenderable(ctx, {
    content: " ○ Password ",
    fg: C.authInactive,
  });

  const authRow = new BoxRenderable(ctx, {
    flexDirection: "row",
  });
  authRow.add(authKeyText);
  authRow.add(authPassText);
  body.add(authRow);

  // ── Conditional field ──────────────────────────────────
  conditionalLabel = new TextRenderable(ctx, {
    content: "Key Path",
    fg: C.labelFg,
  });
  body.add(conditionalLabel);

  conditionalText = new TextRenderable(ctx, {
    content: state.privateKeyPath || "~/.ssh/id_ed25519",
    fg: C.fieldText,
  });

  conditionalBox = new BoxRenderable(ctx, {
    border: true,
    borderColor: C.fieldBorder,
    backgroundColor: C.fieldBg,
    paddingX: 1,
    paddingY: 0,
  });
  conditionalBox.add(conditionalText);
  body.add(conditionalBox);

  // ── Button row ─────────────────────────────────────────
  const btnRow = new BoxRenderable(ctx, {
    flexDirection: "row",
    justifyContent: "center",
    gap: 2,
    marginTop: 1,
  });
  body.add(btnRow);

  // Save
  const saveBox = new BoxRenderable(ctx, {
    border: true,
    borderColor: C.fieldBorder,
    paddingX: 2,
    paddingY: 0,
  });
  saveBtnText = new TextRenderable(ctx, { content: "  Save  ", fg: C.btnSave });
  saveBox.add(saveBtnText);
  btnRow.add(saveBox);

  // Cancel
  const cancelBox = new BoxRenderable(ctx, {
    border: true,
    borderColor: C.fieldBorder,
    paddingX: 2,
    paddingY: 0,
  });
  cancelBtnText = new TextRenderable(ctx, { content: " Cancel ", fg: C.btnDefault });
  cancelBox.add(cancelBtnText);
  btnRow.add(cancelBox);

  // Delete (if editing)
  if (existing) {
    deleteBtnBox = new BoxRenderable(ctx, {
      border: true,
      borderColor: C.fieldBorder,
      paddingX: 2,
      paddingY: 0,
    });
    deleteBtnText = new TextRenderable(ctx, { content: " Delete ", fg: C.btnDanger });
    deleteBtnBox.add(deleteBtnText);
    btnRow.add(deleteBtnBox);
  }

  // ── UI update helpers ──────────────────────────────────

  function getStateKey(fieldIdx: number): keyof FormState {
    const keys: (keyof FormState)[] = ["name", "host", "port", "username"];
    return keys[fieldIdx] ?? "name";
  }

  function refreshTextField(idx: number) {
    if (idx < 0 || idx >= fieldTexts.length) return;
    const k = getStateKey(idx);
    fieldTexts[idx].content = (state[k] as string) || " ";
  }

  function refreshAuthToggle() {
    const isKey = state.authType === "key";
    authKeyText.content = isKey ? " ● Key " : " ○ Key ";
    authKeyText.fg = isKey ? C.authActive : C.authInactive;
    authPassText.content = isKey ? " ○ Password " : " ● Password ";
    authPassText.fg = isKey ? C.authInactive : C.authActive;
  }

  function refreshConditional() {
    const isKey = state.authType === "key";
    conditionalLabel.content = isKey ? "Key Path" : "Password";
    conditionalText.content = isKey
      ? (state.privateKeyPath || "~/.ssh/id_ed25519")
      : maskPassword(state.password || "");
  }

  function updateFocusIndicators() {
    for (let i = 0; i < fieldBoxes.length; i++) {
      fieldBoxes[i].borderColor = i === focusedField ? C.fieldFocusedBorder : C.fieldBorder;
    }
    conditionalBox.borderColor = focusedField === 5 ? C.fieldFocusedBorder : C.fieldBorder;
  }

  function mapFocusToTextIndex(focus: number): number {
    // 0-3 → text fields, 4 → auth toggle, 5 → conditional, 6+ → buttons
    return focus >= 0 && focus < 4 ? focus : -1;
  }

  function getTotalFields(): number {
    return 4 + 1 + 1 + (existing ? 3 : 2); // text + auth + conditional + buttons
  }

  // ── Actions ────────────────────────────────────────────

  function validate(): string[] {
    const errors: string[] = [];
    if (!state.name.trim()) errors.push("Name is required");
    if (!state.host.trim()) {
      errors.push("Host is required");
    }
    const portNum = parseInt(state.port, 10);
    if (isNaN(portNum) || portNum < 1 || portNum > 65535) {
      errors.push("Port must be a number between 1 and 65535");
    }
    if (!state.username.trim()) errors.push("Username is required");
    if (state.authType === "password" && !state.password) {
      errors.push("Password is required when auth type is Password");
    }
    return errors;
  }

  function buildConnectionConfig(): ConnectionConfig | null {
    const portNum = parseInt(state.port, 10);
    if (isNaN(portNum) || portNum < 1 || portNum > 65535) return null;
    if (!state.name.trim() || !state.host.trim() || !state.username.trim()) return null;
    if (state.authType === "password" && !state.password) return null;

    return {
      id: existing?.id ?? crypto.randomUUID(),
      name: state.name.trim(),
      host: state.host.trim(),
      port: portNum,
      username: state.username.trim(),
      authType: state.authType,
      privateKeyPath: state.authType === "key" ? (state.privateKeyPath || "~/.ssh/id_ed25519") : undefined,
      password: state.authType === "password" ? state.password : undefined,
      createdAt: existing?.createdAt ?? new Date().toISOString(),
      lastConnectedAt: existing?.lastConnectedAt,
    };
  }

  function getFormData(): ConnectionConfig | null {
    return buildConnectionConfig();
  }

  function handleSubmit() {
    const errs = validate();
    if (errs.length > 0) return;
    const data = getFormData();
    if (data && onSubmitCb) onSubmitCb(data);
  }

  function focus() {
    hasFocus = true;
    focusedField = 0;
    overlay.focus();
    updateFocusIndicators();
  }

  function destroy() {
    hasFocus = false;
    if (overlay.parent) {
      overlay.parent.remove(overlay.id);
    }
    onSubmitCb = null;
    onCancelCb = null;
    onDeleteCb = null;
  }

  // ── Mount ──────────────────────────────────────────────
  renderer.root.add(overlay);

  const api: FormAPI = {
    getFormData,
    validate,
    onSubmit: (cb) => { onSubmitCb = cb; },
    onCancel: (cb) => { onCancelCb = cb; },
    onDelete: (cb) => { onDeleteCb = cb; },
    focus,
    destroy,
  };

  return Object.assign(overlay, api) as BoxRenderable & FormAPI;
}
