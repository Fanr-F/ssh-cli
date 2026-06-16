import { BoxRenderable, TextRenderable, StyledText } from "@opentui/core";
import type { CliRenderer, KeyEvent, MouseEvent, RenderContext } from "@opentui/core";
import type { ConnectionConfig } from "../types/connection.js";
import { appendFileSync } from "fs";

const LOG_FILE = 'ssh-cli-debug.log';
function logForm(msg: string) {
  try { appendFileSync(LOG_FILE, `[${new Date().toISOString()}] [FORM] ${msg}\n`); } catch {}
}

/** Create a StyledText from a plain string with optional per-char styling */
function makeStyledText(text: string, fg?: string): StyledText {
  const chunks: Array<{
    __isChunk: true;
    text: string;
    fg?: string;
    bg?: string;
    attributes: number;
  }> = [];
  for (const ch of text) {
    chunks.push({ __isChunk: true, text: ch, fg, attributes: 0 });
  }
  return new StyledText(chunks);
}

/** Create StyledText with cursor character highlighted (background color) */
function createStyledWithCursor(text: string, pos: number, fg: string = C.fieldText): StyledText {
  const chunks: Array<{
    __isChunk: true;
    text: string;
    fg?: string;
    bg?: string;
    attributes: number;
  }> = [];
  for (let i = 0; i < text.length; i++) {
    if (i === pos) {
      // Highlight character at cursor position
      chunks.push({ __isChunk: true, text: text[i], fg: '#1a1b26', bg: C.cursorBg, attributes: 0 });
    } else {
      chunks.push({ __isChunk: true, text: text[i], fg, attributes: 0 });
    }
  }
  // When cursor is at end, add a cursor marker (space with inverted colors)
  if (pos >= text.length && text.length > 0) {
    chunks.push({ __isChunk: true, text: ' ', fg: '#1a1b26', bg: C.cursorBg, attributes: 0 });
  }
  return new StyledText(chunks);
}

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
  /** Handle a key event (used when form has keyboard focus) */
  handleKey(key: KeyEvent): void;
  /** Get the content of the currently focused field */
  getFocusedFieldContent(): string;
  /** Remove the form from the renderer and clean up */
  destroy(): void;
}

// ─── Design tokens ────────────────────────────────────────────
// Tokyo Night palette — vibrant, high-contrast
const C = {
  overlayBg: '#000000cc',
  surfaceBg: '#16161e',
  surfaceBorder: '#3b4261',
  titleFg: '#7aa2f7',
  labelFg: '#565f89',
  fieldBg: '#1a1b26',
  fieldBorder: '#3b4261',
  fieldFocusedBorder: '#7aa2f7',
  fieldText: '#c0caf5',
  btnDefault: '#565f89',
  btnSave: '#9ece6a',
  btnDanger: '#f7768e',
  authActive: '#bb9af7',
  authInactive: '#414868',
  cursorBg: '#7aa2f7',  // Cursor highlight background
  dialogWidth: 60,
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
  logForm(`createConnectionForm called, existing=${existing ? 'yes' : 'no'}`);
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
  let passwordRevealed = false;
  let justFocused = true;

  // Cursor state for each text field (0=name, 1=host, 2=port, 3=username, 5=conditional)
  const cursorPositions: number[] = [0, 0, 0, 0, 0, 0]; // index 4 unused (auth toggle)
  let cursorVisible = false;

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
  let eyeIcon: TextRenderable;

  // Buttons
  let saveBtnText: TextRenderable;
  let cancelBtnText: TextRenderable;
  let deleteBtnText: TextRenderable | null = null;
  let deleteBtnBox: BoxRenderable | null = null;
  let saveBox: BoxRenderable;
  let cancelBox: BoxRenderable;
  let authRow: BoxRenderable;

  // ── Key handler ────────────────────────────────────────
  function handleKeyDown(key: KeyEvent) {
    if (!hasFocus) return;
    logForm(`handleKeyDown: name=${key.name}, ctrl=${key.ctrl}, shift=${key.shift}`);

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
      justFocused = true;
      cursorVisible = false;
      // Reset cursor position to end of new field's text
      const idx = mapFocusToTextIndex(focusedField);
      if (idx >= 0) {
        const k = getStateKey(idx);
        const text = (state[k] as string) || "";
        cursorPositions[idx] = text.length;
      } else if (focusedField === 5) {
        const text = state.authType === "key" ? state.privateKeyPath : state.password;
        cursorPositions[5] = text.length;
      }
      updateFocusIndicators();
      return;
    }

    // Up/Down arrows to navigate between fields
    if (key.name === "up" || key.name === "down") {
      key.preventDefault();
      const dir = key.name === "down" ? 1 : -1;
      const total = getTotalFields();
      focusedField = ((focusedField + dir) % total + total) % total;
      justFocused = true;
      cursorVisible = false;
      // Reset cursor position to end of new field's text
      const idx = mapFocusToTextIndex(focusedField);
      if (idx >= 0) {
        const k = getStateKey(idx);
        const text = (state[k] as string) || "";
        cursorPositions[idx] = text.length;
      } else if (focusedField === 5) {
        const text = state.authType === "key" ? state.privateKeyPath : state.password;
        cursorPositions[5] = text.length;
      }
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

    // Left/Right arrows to move cursor
    if (key.name === "left" || key.name === "right") {
      key.preventDefault();
      justFocused = false;
      cursorVisible = true;
      const idx = mapFocusToTextIndex(focusedField);
      if (idx >= 0) {
        const k = getStateKey(idx);
        const text = (state[k] as string) || "";
        const pos = cursorPositions[idx];
        if (key.name === "left") {
          cursorPositions[idx] = Math.max(0, pos - 1);
        } else {
          cursorPositions[idx] = Math.min(text.length, pos + 1);
        }
        refreshTextField(idx);
      } else if (focusedField === 5) {
        const text = state.authType === "key" ? state.privateKeyPath : state.password;
        const pos = cursorPositions[5];
        if (key.name === "left") {
          cursorPositions[5] = Math.max(0, pos - 1);
        } else {
          cursorPositions[5] = Math.min(text.length, pos + 1);
        }
        refreshConditional();
      }
      return;
    }

    // Home key - move to start
    if (key.name === "home") {
      key.preventDefault();
      justFocused = false;
      cursorVisible = true;
      const idx = mapFocusToTextIndex(focusedField);
      if (idx >= 0) {
        cursorPositions[idx] = 0;
        refreshTextField(idx);
      } else if (focusedField === 5) {
        cursorPositions[5] = 0;
        refreshConditional();
      }
      return;
    }

    // End key - move to end
    if (key.name === "end") {
      key.preventDefault();
      justFocused = false;
      cursorVisible = true;
      const idx = mapFocusToTextIndex(focusedField);
      if (idx >= 0) {
        const k = getStateKey(idx);
        const text = (state[k] as string) || "";
        cursorPositions[idx] = text.length;
        refreshTextField(idx);
      } else if (focusedField === 5) {
        const text = state.authType === "key" ? state.privateKeyPath : state.password;
        cursorPositions[5] = text.length;
        refreshConditional();
      }
      return;
    }

    // Backspace
    if (key.name === "backspace") {
      key.preventDefault();
      justFocused = false;
      cursorVisible = true;
      const idx = mapFocusToTextIndex(focusedField);
      if (idx >= 0) {
        const k = getStateKey(idx);
        const text = (state[k] as string) || "";
        const pos = cursorPositions[idx];
        if (pos > 0) {
          state[k] = (text.slice(0, pos - 1) + text.slice(pos)) as never;
          cursorPositions[idx] = pos - 1;
          refreshTextField(idx);
        }
      } else if (focusedField === 5) {
        if (state.authType === "key") {
          const pos = cursorPositions[5];
          if (pos > 0) {
            state.privateKeyPath = state.privateKeyPath.slice(0, pos - 1) + state.privateKeyPath.slice(pos);
            cursorPositions[5] = pos - 1;
            refreshConditional();
          }
        } else {
          const pos = cursorPositions[5];
          if (pos > 0) {
            state.password = state.password.slice(0, pos - 1) + state.password.slice(pos);
            cursorPositions[5] = pos - 1;
            refreshConditional();
          }
        }
      }
      return;
    }

    // Delete
    if (key.name === "delete") {
      key.preventDefault();
      justFocused = false;
      cursorVisible = true;
      const idx = mapFocusToTextIndex(focusedField);
      if (idx >= 0) {
        const k = getStateKey(idx);
        const text = (state[k] as string) || "";
        const pos = cursorPositions[idx];
        if (pos < text.length) {
          state[k] = (text.slice(0, pos) + text.slice(pos + 1)) as never;
          refreshTextField(idx);
        }
      } else if (focusedField === 5) {
        if (state.authType === "key") {
          const pos = cursorPositions[5];
          if (pos < state.privateKeyPath.length) {
            state.privateKeyPath = state.privateKeyPath.slice(0, pos) + state.privateKeyPath.slice(pos + 1);
            refreshConditional();
          }
        } else {
          const pos = cursorPositions[5];
          if (pos < state.password.length) {
            state.password = state.password.slice(0, pos) + state.password.slice(pos + 1);
            refreshConditional();
          }
        }
      }
      return;
    }

    // Printable character input
    if (key.name.length === 1 && !key.ctrl && !key.meta && !key.option) {
      key.preventDefault();
      const ch = key.shift ? key.name.toUpperCase() : key.name;
      const wasCursorHidden = !cursorVisible;
      justFocused = false;
      cursorVisible = true;
      const idx = mapFocusToTextIndex(focusedField);
      
      if (idx >= 0) {
        const k = getStateKey(idx);
        if (wasCursorHidden) {
          // No cursor visible → replace entire field content
          state[k] = ch as never;
          cursorPositions[idx] = 1;
        } else {
          // Cursor visible → insert at cursor position
          const text = (state[k] as string) || "";
          const pos = cursorPositions[idx];
          state[k] = (text.slice(0, pos) + ch + text.slice(pos)) as never;
          cursorPositions[idx] = pos + 1;
        }
        refreshTextField(idx);
      } else if (focusedField === 5) {
        if (wasCursorHidden) {
          // No cursor visible → replace entire field content
          if (state.authType === "key") {
            state.privateKeyPath = ch;
          } else {
            state.password = ch;
          }
          cursorPositions[5] = 1;
        } else {
          // Cursor visible → insert at cursor position
          const pos = cursorPositions[5];
          if (state.authType === "key") {
            state.privateKeyPath = state.privateKeyPath.slice(0, pos) + ch + state.privateKeyPath.slice(pos);
          } else {
            state.password = state.password.slice(0, pos) + ch + state.password.slice(pos);
          }
          cursorPositions[5] = pos + 1;
        }
        refreshConditional();
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

  for (let i = 0; i < textFieldDefs.length; i++) {
    const fd = textFieldDefs[i];
    const lbl = new TextRenderable(ctx, {
      content: fd.label,
      fg: C.labelFg,
    });
    fieldLabels.push(lbl);

    const val = new TextRenderable(ctx, {
      content: getInitialText(fd.key),
      fg: C.fieldText,
    });
    // Set initial styled text
    val.textBuffer.setStyledText(makeStyledText(getInitialText(fd.key), C.fieldText));
    fieldTexts.push(val);

    const inp = new BoxRenderable(ctx, {
      border: true,
      borderColor: C.fieldBorder,
      backgroundColor: C.fieldBg,
      paddingX: 1,
      paddingY: 0,
      onMouseDown: (e: MouseEvent) => {
        e.stopPropagation();
        focusedField = i;
        justFocused = false;
        cursorVisible = true;
        // Position cursor at end on click
        const k = getStateKey(i);
        const text = (state[k] as string) || "";
        cursorPositions[i] = text.length;
        updateFocusIndicators();
        hasFocus = true;
      },
    });
    inp.add(val);
    fieldBoxes.push(inp);

    body.add(lbl);
    body.add(inp);
  }

  function getInitialText(key: string): string {
    const s = state as unknown as Record<string, string>;
    const v = s[key];
    return v || (key === "port" ? "22" : " ");
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

  authRow = new BoxRenderable(ctx, {
    flexDirection: "row",
    border: true,
    borderColor: C.fieldBorder,
    onMouseDown: (e: MouseEvent) => {
      e.stopPropagation();
      // Toggle auth type on click
      state.authType = state.authType === "key" ? "password" : "key";
      refreshAuthToggle();
      refreshConditional();
      focusedField = 4;
      updateFocusIndicators();
      hasFocus = true;
    },
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
  // Set initial styled text
  conditionalText.textBuffer.setStyledText(makeStyledText(state.privateKeyPath || "~/.ssh/id_ed25519", C.fieldText));

  conditionalBox = new BoxRenderable(ctx, {
    flexDirection: "row",
    border: true,
    borderColor: C.fieldBorder,
    backgroundColor: C.fieldBg,
    paddingX: 1,
    paddingY: 0,
    onMouseDown: (e: MouseEvent) => {
      e.stopPropagation();
      focusedField = 5;
      justFocused = false;
      cursorVisible = true;
      // Position cursor at end on click
      const text = state.authType === "key" ? state.privateKeyPath : state.password;
      cursorPositions[5] = text.length;
      updateFocusIndicators();
      hasFocus = true;
    },
  });

  // Text wrapper — flexGrow: 1 pushes the eye icon to the right edge
  const conditionalTextWrapper = new BoxRenderable(ctx, {
    flexDirection: "row",
    flexGrow: 1,
  });
  conditionalTextWrapper.add(conditionalText);
  conditionalBox.add(conditionalTextWrapper);

  // Eye icon — press and hold to reveal password plaintext
  eyeIcon = new TextRenderable(ctx, {
    content: "\u{1F441}",
    fg: C.labelFg,
    onMouseDown: (e: MouseEvent) => {
      e.stopPropagation();
      focusedField = 5;
      justFocused = false;
      cursorVisible = true;
      // Position cursor at end on click
      const text = state.authType === "key" ? state.privateKeyPath : state.password;
      cursorPositions[5] = text.length;
      updateFocusIndicators();
      hasFocus = true;
      passwordRevealed = true;
      refreshConditional();
    },
    onMouseUp: (e: MouseEvent) => {
      e.stopPropagation();
      passwordRevealed = false;
      refreshConditional();
    },
  });
  conditionalBox.add(eyeIcon);

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
  saveBox = new BoxRenderable(ctx, {
    border: true,
    borderColor: C.fieldBorder,
    paddingX: 2,
    paddingY: 0,
    onMouseDown: (e: MouseEvent) => {
      e.stopPropagation();
      handleSubmit();
    },
  });
  saveBtnText = new TextRenderable(ctx, { content: "  Save  ", fg: C.btnSave });
  saveBox.add(saveBtnText);
  btnRow.add(saveBox);

  // Cancel
  cancelBox = new BoxRenderable(ctx, {
    border: true,
    borderColor: C.fieldBorder,
    paddingX: 2,
    paddingY: 0,
    onMouseDown: (e: MouseEvent) => {
      e.stopPropagation();
      if (onCancelCb) onCancelCb();
    },
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
      onMouseDown: (e: MouseEvent) => {
        e.stopPropagation();
        if (onDeleteCb) onDeleteCb(existing.id);
      },
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
    const text = (state[k] as string) || " ";
    try {
      if (idx === focusedField && cursorVisible) {
        const cursorPos = cursorPositions[idx];
        if (text.length > 0) {
          fieldTexts[idx].textBuffer.setStyledText(createStyledWithCursor(text, cursorPos));
        } else {
          fieldTexts[idx].textBuffer.setStyledText(makeStyledText(text, C.fieldText));
        }
      } else {
        fieldTexts[idx].textBuffer.setStyledText(makeStyledText(text, C.fieldText));
      }
    } catch (err) {
      logForm(`refreshTextField error: ${err}`);
    }
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
    const showCursor = focusedField === 5 && cursorVisible;
    try {
      if (isKey) {
        const text = state.privateKeyPath || "~/.ssh/id_ed25519";
        if (showCursor) {
          if (text.length > 0) {
            conditionalText.textBuffer.setStyledText(createStyledWithCursor(text, cursorPositions[5]));
          } else {
            conditionalText.textBuffer.setStyledText(makeStyledText(text, C.fieldText));
          }
        } else {
          conditionalText.textBuffer.setStyledText(makeStyledText(text, C.fieldText));
        }
      } else {
        const displayText = passwordRevealed
          ? (state.password || " ")
          : maskPassword(state.password || "");
        if (showCursor) {
          if (displayText.length > 0) {
            conditionalText.textBuffer.setStyledText(createStyledWithCursor(displayText, cursorPositions[5]));
          } else {
            conditionalText.textBuffer.setStyledText(makeStyledText(displayText, C.fieldText));
          }
        } else {
          conditionalText.textBuffer.setStyledText(makeStyledText(displayText, C.fieldText));
        }
      }
      // Show/hide eye icon based on auth type
      eyeIcon.visible = !isKey;
    } catch (err) {
      logForm(`refreshConditional error: ${err}`);
    }
  }

  function updateFocusIndicators() {
    // Text field boxes (0-3)
    for (let i = 0; i < fieldBoxes.length; i++) {
      fieldBoxes[i].borderColor = i === focusedField ? C.fieldFocusedBorder : C.fieldBorder;
    }
    // Conditional field (5)
    conditionalBox.borderColor = focusedField === 5 ? C.fieldFocusedBorder : C.fieldBorder;
    // Auth toggle (4)
    authRow.borderColor = focusedField === 4 ? C.fieldFocusedBorder : C.fieldBorder;
    // Buttons (6=save, 7=cancel, 8=delete)
    saveBox.borderColor = focusedField === 6 ? C.fieldFocusedBorder : C.fieldBorder;
    cancelBox.borderColor = focusedField === 7 ? C.fieldFocusedBorder : C.fieldBorder;
    if (deleteBtnBox) {
      deleteBtnBox.borderColor = focusedField === 8 ? C.fieldFocusedBorder : C.fieldBorder;
    }
    // Update cursor display for all text fields
    for (let i = 0; i < fieldTexts.length; i++) {
      refreshTextField(i);
    }
    // Update cursor for conditional field
    refreshConditional();
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

  function getFocusedFieldContent(): string {
    if (focusedField >= 0 && focusedField < 4) {
      const k = getStateKey(focusedField);
      return state[k] as string;
    } else if (focusedField === 5) {
      return state.authType === "key" ? state.privateKeyPath : state.password;
    }
    return "";
  }

  function handleSubmit() {
    const errs = validate();
    if (errs.length > 0) return;
    const data = getFormData();
    if (data && onSubmitCb) onSubmitCb(data);
  }

  function focus() {
    hasFocus = true;
    justFocused = true;
    cursorVisible = false;
    // Initialize cursor positions to end of each field
    for (let i = 0; i < 4; i++) {
      const k = getStateKey(i);
      const text = (state[k] as string) || "";
      cursorPositions[i] = text.length;
    }
    const condText = state.authType === "key" ? state.privateKeyPath : state.password;
    cursorPositions[5] = condText.length;
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

  // ── Sync initial UI state ────────────────────────────────
  // The state is correctly initialised from `existing` (authType, password,
  // etc.) but the rendered toggle / conditional field only update on user
  // interaction.  Sync them once so the form reflects saved data.
  refreshAuthToggle();
  refreshConditional();

  // ── Mount ──────────────────────────────────────────────
  renderer.root.add(overlay);

  const api: FormAPI = {
    getFormData,
    getFocusedFieldContent,
    validate,
    onSubmit: (cb) => { onSubmitCb = cb; },
    onCancel: (cb) => { onCancelCb = cb; },
    onDelete: (cb) => { onDeleteCb = cb; },
    focus,
    handleKey: handleKeyDown,
    destroy,
  };

  return Object.assign(overlay, api) as BoxRenderable & FormAPI;
}
