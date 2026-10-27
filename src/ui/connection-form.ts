import { BoxRenderable, TextRenderable, StyledText, InputRenderable, type TextChunk } from "@opentui/core";
import type { CliRenderer, KeyEvent, MouseEvent, RenderContext } from "@opentui/core";
import type { ConnectionConfig } from "../types/connection.js";
import { createLogger } from "../logger";
import { toRGBA } from "../color";
import { findBinding, normalizeKey, type KeyContext } from "../keymap";

const logForm = createLogger('form');

/** Create a StyledText from a plain string with optional per-char styling */
function makeStyledText(text: string, fg?: string): StyledText {
  const chunks: TextChunk[] = [];
  const color = toRGBA(fg);
  for (const ch of text) {
    chunks.push({ __isChunk: true, text: ch, fg: color, attributes: 0 });
  }
  return new StyledText(chunks);
}

/** Create StyledText with cursor character highlighted (background color) */
function createStyledWithCursor(text: string, pos: number, fg: string = C.fieldText): StyledText {
  const chunks: TextChunk[] = [];
  const fieldFg = toRGBA(fg);
  const cursorFg = toRGBA('#1a1b26');
  const cursorBg = toRGBA(C.cursorBg);
  for (let i = 0; i < text.length; i++) {
    if (i === pos) {
      // Highlight character at cursor position
      chunks.push({ __isChunk: true, text: text[i], fg: cursorFg, bg: cursorBg, attributes: 0 });
    } else {
      chunks.push({ __isChunk: true, text: text[i], fg: fieldFg, attributes: 0 });
    }
  }
  // When cursor is at end, add a cursor marker (space with inverted colors)
  if (pos >= text.length && text.length > 0) {
    chunks.push({ __isChunk: true, text: ' ', fg: cursorFg, bg: cursorBg, attributes: 0 });
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
  /**
   * 表单是否需要拦截原始按键。
   * 只有密码框（InputRenderable 没有遮罩能力，仍是手写编辑）返回 true；
   * 其他字段放行给聚焦的 InputRenderable，由它原生处理光标 / 选区 / 撤销。
   */
  captureRawKeys(): boolean;
  /** Register a callback for paste requests (the clipboard backend lives in App) */
  onPasteRequest(cb: () => void): void;
  /** Insert text into the focused field (right-click paste / bracketed paste) */
  pasteText(text: string): void;
  /** Index of the focused field (used by the shared keymap context) */
  getFocusedFieldIndex(): number;
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
  logForm.debug(`createConnectionForm called, existing=${existing ? 'yes' : 'no'}`);
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
  let onPasteRequestCb: (() => void) | null = null;

  let hasFocus = false;
  let focusedField = 0;
  let passwordRevealed = false;

  // 光标位置只剩密码框还需要手写维护（其余字段由 InputRenderable 管理）
  let passwordCursor = 0;
  // 密码框的「第一次输入覆盖原值」（普通字段改用 InputRenderable.selectAll()）
  let replaceOnType = true;

  // ── Renderable references (stored for direct updates) ──

  // Text-input fields: 0=name, 1=host, 2=port, 3=username
  const textFieldKeys = ["name", "host", "port", "username"] as const;
  const fieldBoxes: BoxRenderable[] = [];
  const textInputs: InputRenderable[] = [];
  const fieldLabels: TextRenderable[] = [];

  // Auth toggle
  let authKeyText: TextRenderable;
  let authPassText: TextRenderable;

  // Conditional field (key path | password)
  let conditionalLabel: TextRenderable;
  let conditionalText: TextRenderable;
  let keyPathInput: InputRenderable;
  let conditionalBox: BoxRenderable;
  let conditionalTextWrapper: BoxRenderable;
  let conditionalChild: "key" | "password" | "none" = "none";
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
  function isPrintable(key: KeyEvent): boolean {
    return !!key.sequence && key.name.length === 1 && !key.ctrl && !key.meta && !key.option;
  }

  /**
   * 让当前聚焦字段对应的输入框获得光标（其余失焦）。
   * `selectContent` 为 true 时顺带全选原内容——键盘切换字段（Tab / ↑↓ / 打开表单）
   * 用它，于是「第一个字符替换原值」；鼠标点击时传 false，
   * 让 OpenTUI 自己的单元格选区把光标落到点击处。
   */
  function focusCurrentInput(selectContent = true): void {
    for (const input of textInputs) input.blur();
    keyPathInput.blur();
    let active: InputRenderable | null = null;
    if (focusedField >= 0 && focusedField < 4) {
      active = textInputs[focusedField];
    } else if (focusedField === 5 && state.authType === "key") {
      active = keyPathInput;
    }
    if (!active) return;
    active.focus();
    if (selectContent) active.selectAll();
  }

  /** Tab / ↑↓ 切换字段 */
  function moveFocus(dir: 1 | -1): void {
    const total = getTotalFields();
    focusedField = ((focusedField + dir) % total + total) % total;
    replaceOnType = true;
    if (focusedField === 5) passwordCursor = state.password.length;
    focusCurrentInput();
    updateFocusIndicators();
  }

  function handleKeyDown(key: KeyEvent) {
    if (!hasFocus) return;

    const k = normalizeKey(key);
    const ctx: KeyContext = {
      focus: "form",
      helpOpen: false,
      formOpen: true,
      sftpCmdMode: false,
      formField: focusedField,
      activeTabType: null,
    };
    const binding = findBinding("form", k, ctx);
    logForm.debug(
      `handleKeyDown: name=${k.name}, binding=${binding?.id ?? "-"}, focusedField=${focusedField}, replaceOnType=${replaceOnType}`,
    );

    switch (binding?.id) {
      case "form.cancel":
        key.preventDefault();
        if (onCancelCb) onCancelCb();
        return;

      case "form.submit":
        key.preventDefault();
        handleSubmit();
        return;

      case "form.nextField":
      case "form.focusNext":
        key.preventDefault();
        moveFocus(1);
        return;

      case "form.prevField":
      case "form.focusPrev":
        key.preventDefault();
        moveFocus(-1);
        return;

      // Auth toggle（字段 4）— ←/→ 切换 Key / Password
      case "form.authKey":
      case "form.authPassword":
        key.preventDefault();
        state.authType = binding.id === "form.authKey" ? "key" : "password";
        replaceOnType = true;
        passwordCursor = state.password.length;
        refreshAuthToggle();
        refreshConditional();
        focusCurrentInput();
        return;

      default:
        break;
    }

    // 走到这里只剩两种情况：
    //   1. 密码框（captureRawKeys() 为 true，App 把原始按键转进来）；
    //   2. 焦点落在 overlay 上（点到了标签 / 边框空白），此时输入框没聚焦，
    //      只能由这里直接把按键喂给 edit buffer（光标不可见，但输入不丢）。
    // 输入框聚焦时按键由它原生处理，不会到这里。

    // 字段 0-3
    if (focusedField >= 0 && focusedField < 4) {
      const input = textInputs[focusedField];
      key.preventDefault();
      input.handleKeyPress(key);
      state[textFieldKeys[focusedField]] = input.value;
      return;
    }

    // 字段 5（Key Path）
    if (focusedField === 5 && state.authType === "key") {
      key.preventDefault();
      keyPathInput.handleKeyPress(key);
      state.privateKeyPath = keyPathInput.value;
      return;
    }

    // 字段 5（Password）— 唯一保留的手写编辑（InputRenderable 没有遮罩能力）
    if (focusedField === 5 && state.authType === "password") {
      key.preventDefault();
      editPassword(key);
      return;
    }
  }

  /** 密码框编辑（遮罩与显示/隐藏切换仍由本文件维护） */
  function editPassword(key: KeyEvent): void {
    if (key.name === "left") {
      replaceOnType = false;
      passwordCursor = Math.max(0, passwordCursor - 1);
    } else if (key.name === "right") {
      replaceOnType = false;
      passwordCursor = Math.min(state.password.length, passwordCursor + 1);
    } else if (key.name === "home") {
      replaceOnType = false;
      passwordCursor = 0;
    } else if (key.name === "end") {
      replaceOnType = false;
      passwordCursor = state.password.length;
    } else if (key.name === "backspace") {
      if (replaceOnType) {
        state.password = "";
        passwordCursor = 0;
      } else if (passwordCursor > 0) {
        state.password = state.password.slice(0, passwordCursor - 1) + state.password.slice(passwordCursor);
        passwordCursor--;
      }
      replaceOnType = false;
    } else if (key.name === "delete") {
      if (!replaceOnType && passwordCursor < state.password.length) {
        state.password = state.password.slice(0, passwordCursor) + state.password.slice(passwordCursor + 1);
      }
      replaceOnType = false;
    } else if (isPrintable(key)) {
      const ch = key.sequence;
      if (replaceOnType) {
        state.password = ch;
        passwordCursor = ch.length;
      } else {
        state.password = state.password.slice(0, passwordCursor) + ch + state.password.slice(passwordCursor);
        passwordCursor += ch.length;
      }
      replaceOnType = false;
    }
    refreshConditional();
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
    onMouseDown: (e: MouseEvent) => {
      // 点到空白处时把焦点还给当前字段，否则按键会落到没有输入框的 overlay 上。
      // preventDefault 阻止 renderer 的 autoFocus 反过来把焦点抢到 overlay。
      if (e.button !== 0) return;
      e.preventDefault();
      hasFocus = true;
      focusCurrentInput(false);
      updateFocusIndicators();
    },
  });

  const dialog = new BoxRenderable(ctx, {
    id: "conn-form-dialog",
    flexDirection: "column",
    border: true,
    borderColor: C.surfaceBorder,
    backgroundColor: C.surfaceBg,
    // 固定宽度：InputRenderable 的 width:"100%" 撑不住自动宽度（会把弹窗拉到整屏）
    width: C.dialogWidth,
    minWidth: C.dialogWidth,
    maxHeight: "100%",
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
    key: (typeof textFieldKeys)[number];
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

    // 编辑 / 光标 / 选区 / 撤销全部由 OpenTUI 负责
    const input = new InputRenderable(ctx, {
      width: "100%",
      value: state[fd.key],
      textColor: C.fieldText,
      focusedTextColor: C.fieldText,
      cursorColor: C.cursorBg,
      cursorStyle: { style: "block", blinking: true },
      // OpenTUI 默认把 Ctrl+A 绑成 line-home（Unix 习惯），这里改回「全选」
      keyBindings: [{ name: "a", ctrl: true, action: "select-all" }],
    });
    input.onContentChange = () => {
      state[fd.key] = input.value;
    };
    textInputs.push(input);

    const fieldBox = new BoxRenderable(ctx, {
      border: true,
      borderColor: C.fieldBorder,
      backgroundColor: C.fieldBg,
      paddingX: 1,
      paddingY: 0,
      onMouseDown: (e: MouseEvent) => {
        e.stopPropagation();
        // 别让 renderer 的 autoFocus 把焦点从 InputRenderable 抢回 overlay
        e.preventDefault();
        hasFocus = true;
        focusedField = i;
        if (e.button === 2) {
          // 右键 = 粘贴到该字段（光标处插入，不覆盖原值）
          focusCurrentInput(false);
          updateFocusIndicators();
          onPasteRequestCb?.();
          return;
        }
        focusCurrentInput(false);
        updateFocusIndicators();
      },
    });
    fieldBox.add(input);
    fieldBoxes.push(fieldBox);

    body.add(lbl);
    body.add(fieldBox);
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
      e.preventDefault();
      if (e.button === 2) return; // 右键不翻认证类型
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
    content: makeStyledText(state.privateKeyPath || "~/.ssh/id_ed25519", C.fieldText),
    fg: C.fieldText,
  });

  // Key Path 输入框（密码模式时换成下面的 conditionalText 手写渲染）
  keyPathInput = new InputRenderable(ctx, {
    width: "100%",
    value: state.privateKeyPath,
    textColor: C.fieldText,
    focusedTextColor: C.fieldText,
    cursorColor: C.cursorBg,
    cursorStyle: { style: "block", blinking: true },
    keyBindings: [{ name: "a", ctrl: true, action: "select-all" }],
  });
  keyPathInput.onContentChange = () => {
    state.privateKeyPath = keyPathInput.value;
  };

  conditionalBox = new BoxRenderable(ctx, {
    flexDirection: "row",
    border: true,
    borderColor: C.fieldBorder,
    backgroundColor: C.fieldBg,
    paddingX: 1,
    paddingY: 0,
    onMouseDown: (e: MouseEvent) => {
      e.stopPropagation();
      e.preventDefault();
      focusedField = 5;
      hasFocus = true;
      if (e.button === 2) {
        focusCurrentInput(false);
        updateFocusIndicators();
        onPasteRequestCb?.();
        return;
      }
      if (state.authType === "password") passwordCursor = state.password.length;
      focusCurrentInput(false);
      updateFocusIndicators();
    },
  });

  // Text wrapper — flexGrow: 1 pushes the eye icon to the right edge
  conditionalTextWrapper = new BoxRenderable(ctx, {
    flexDirection: "row",
    flexGrow: 1,
  });
  conditionalBox.add(conditionalTextWrapper);

  // Eye icon — press and hold to reveal password plaintext
  eyeIcon = new TextRenderable(ctx, {
    content: "\u{1F441}",
    fg: C.labelFg,
    onMouseDown: (e: MouseEvent) => {
      e.stopPropagation();
      e.preventDefault();
      if (e.button === 2) return;
      focusedField = 5;
      replaceOnType = false;
      passwordCursor = state.password.length;
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
      e.preventDefault();
      if (e.button === 2) return;
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
      e.preventDefault();
      if (e.button === 2) return;
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
        e.preventDefault();
        if (e.button === 2) return;
        if (onDeleteCb) onDeleteCb(existing.id);
      },
    });
    deleteBtnText = new TextRenderable(ctx, { content: " Delete ", fg: C.btnDanger });
    deleteBtnBox.add(deleteBtnText);
    btnRow.add(deleteBtnBox);
  }

  // ── UI update helpers ──────────────────────────────────

  function refreshAuthToggle() {
    const isKey = state.authType === "key";
    authKeyText.content = isKey ? " ● Key " : " ○ Key ";
    authKeyText.fg = isKey ? C.authActive : C.authInactive;
    authPassText.content = isKey ? " ○ Password " : " ● Password ";
    authPassText.fg = isKey ? C.authInactive : C.authActive;
  }

  /** 在 Key Path 输入框与密码手写渲染之间切换 */
  function syncConditionalChild(isKey: boolean) {
    const target = isKey ? "key" : "password";
    if (conditionalChild === target) return;
    const current =
      conditionalChild === "key" ? keyPathInput : conditionalChild === "password" ? conditionalText : null;
    if (current) conditionalTextWrapper.remove(current);
    conditionalTextWrapper.add(isKey ? keyPathInput : conditionalText);
    conditionalChild = target;
  }

  function refreshConditional() {
    const isKey = state.authType === "key";
    conditionalLabel.content = isKey ? "Key Path" : "Password";
    syncConditionalChild(isKey);
    // Key Path 模式下文本由 InputRenderable 自己渲染，无需刷新
    if (!isKey) {
      const displayText = passwordRevealed
        ? (state.password || " ")
        : maskPassword(state.password || "");
      try {
        if (focusedField === 5 && displayText.length > 0) {
          conditionalText.content = createStyledWithCursor(displayText, passwordCursor);
        } else {
          conditionalText.content = makeStyledText(displayText, C.fieldText);
        }
      } catch (err) {
        logForm.debug(`refreshConditional error: ${err}`);
      }
    }
    // Show/hide eye icon based on auth type
    eyeIcon.visible = !isKey;
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
    // Conditional field (5) 的文本刷新（密码光标 / 显示切换）
    refreshConditional();
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

  function getFocusedFieldIndex(): number {
    return focusedField;
  }

  /** 只有密码框需要原始按键（其余字段由 InputRenderable 原生处理） */
  function captureRawKeys(): boolean {
    return hasFocus && focusedField === 5 && state.authType === "password";
  }

  /**
   * 把文本插入当前字段：右键粘贴与终端发起的 bracketed paste 都走这里。
   * 普通字段交给 InputRenderable.insertText()（单行、自动截断换行）；
   * 密码框没有 InputRenderable，按手写光标插入。
   */
  function pasteText(text: string): void {
    if (!hasFocus || !text) return;

    if (focusedField >= 0 && focusedField < 4) {
      const input = textInputs[focusedField];
      input.insertText(text);
      state[textFieldKeys[focusedField]] = input.value;
      return;
    }

    if (focusedField === 5 && state.authType === "key") {
      keyPathInput.insertText(text);
      state.privateKeyPath = keyPathInput.value;
      return;
    }

    if (focusedField === 5 && state.authType === "password") {
      const clean = text.replace(/[\n\r]/g, "");
      if (!clean) return;
      if (replaceOnType) {
        state.password = "";
        passwordCursor = 0;
        replaceOnType = false;
      }
      state.password =
        state.password.slice(0, passwordCursor) + clean + state.password.slice(passwordCursor);
      passwordCursor += clean.length;
      refreshConditional();
    }
  }

  function handleSubmit() {
    const errs = validate();
    if (errs.length > 0) return;
    const data = getFormData();
    if (data && onSubmitCb) onSubmitCb(data);
  }

  function focus() {
    hasFocus = true;
    replaceOnType = true;
    passwordCursor = state.password.length;
    focusCurrentInput();
    logForm.debug(
      `focus() called: focusedField=${focusedField}, passwordCursor=${passwordCursor}, inputFocused=${textInputs[0]?.focused}`,
    );
    updateFocusIndicators();
  }

  function destroy() {
    hasFocus = false;
    // 释放 InputRenderable 的焦点与按键监听
    for (const input of textInputs) input.blur();
    keyPathInput.blur();
    if (overlay.parent) {
      // OpenTUI 0.6：remove() 只接受 renderable 对象，传 id 会抛错
      overlay.parent.remove(overlay);
    }
    onSubmitCb = null;
    onCancelCb = null;
    onDeleteCb = null;
    onPasteRequestCb = null;
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
    getFocusedFieldIndex,
    captureRawKeys,
    pasteText,
    validate,
    onSubmit: (cb) => { onSubmitCb = cb; },
    onCancel: (cb) => { onCancelCb = cb; },
    onDelete: (cb) => { onDeleteCb = cb; },
    onPasteRequest: (cb) => { onPasteRequestCb = cb; },
    focus,
    handleKey: handleKeyDown,
    destroy,
  };

  return Object.assign(overlay, api) as BoxRenderable & FormAPI;
}
