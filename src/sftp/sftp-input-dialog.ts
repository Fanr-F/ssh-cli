import { Box, Text, InputRenderable } from '@opentui/core';
import type { CliRenderer, KeyEvent } from '@opentui/core';
import { createLogger } from '../logger';

const log = createLogger('sftp-dialog');

// ── Tokyo Night palette ───────────────────────────────────────
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
  btnConfirm: '#9ece6a',
  cursorBg: '#7aa2f7',
  errorFg: '#f7768e',
  dialogWidth: 60,
};

export interface InputDialogAPI {
  focus(): void;
  handleKey(key: KeyEvent): void;
  destroy(): void;
  onError(msg: string): void;
}

/**
 * Create a path input dialog for SFTP upload/download.
 *
 * Editing (cursor movement, insertion, selection, undo) is delegated to
 * OpenTUI's `InputRenderable`; this module only owns the dialog chrome,
 * the Enter/Esc semantics and the error line.
 *
 * @param renderer - OpenTUI renderer
 * @param title - Dialog title (e.g. "Upload File" or "Download File")
 * @param label - Input label (e.g. "Local path:" or "Remote path:")
 * @param placeholder - Placeholder text
 * @param onSubmit - Callback with the entered path
 * @param onCancel - Callback when cancelled
 */
export function createInputDialog(
  renderer: CliRenderer,
  title: string,
  label: string,
  placeholder: string,
  onSubmit: (path: string) => void,
  onCancel: () => void,
): InputDialogAPI {
  let errorMsg = '';

  // 单行输入框。编辑、光标、选区、撤销全部由 OpenTUI 负责。
  const input = new InputRenderable(renderer.root.ctx, {
    id: 'sftp-input-control',
    width: '100%',
    textColor: C.fieldText,
    focusedTextColor: C.fieldText,
    placeholder,
    placeholderColor: C.labelFg,
    cursorColor: C.cursorBg,
    cursorStyle: { style: 'block', blinking: true },
  });

  // ── Build overlay ──────────────────────────────────────────
  const overlay = Box(
    {
      id: 'sftp-input-overlay',
      position: 'absolute',
      top: 0,
      left: 0,
      width: '100%',
      height: '100%',
      backgroundColor: C.overlayBg,
      justifyContent: 'center',
      alignItems: 'center',
      zIndex: 1000,
    },
    // Dialog box
    Box(
      {
        id: 'sftp-input-dialog',
        flexDirection: 'column',
        width: C.dialogWidth,
        backgroundColor: C.surfaceBg,
        border: true,
        borderColor: C.surfaceBorder,
        padding: 1,
      },
      // Title
      Text({ content: ` ${title} `, fg: C.titleFg }),
      // Spacer
      Text({ content: '' }),
      // Label
      Text({ content: ` ${label}`, fg: C.labelFg }),
      // Input field (border + one content row)
      Box(
        {
          id: 'sftp-input-field',
          flexDirection: 'row',
          height: 3,
          backgroundColor: C.fieldBg,
          border: true,
          borderColor: C.fieldFocusedBorder,
          paddingX: 1,
        },
        input,
      ),
      // Error message
      Text({ content: '', fg: C.errorFg, id: 'sftp-input-error' }),
      // Spacer
      Text({ content: '' }),
      // Buttons row
      Box(
        { flexDirection: 'row', justifyContent: 'center' },
        Text({ content: ' Enter:确认  Esc:取消 ', fg: C.btnDefault }),
      ),
    ),
  );

  renderer.root.add(overlay);

  // ── Error line ─────────────────────────────────────────────
  let _resolvedErrorText: any = null;

  function getErrorText(): any {
    if (!_resolvedErrorText) {
      const dialog = renderer.root.findDescendantById('sftp-input-dialog');
      if (dialog) {
        _resolvedErrorText = dialog.findDescendantById('sftp-input-error');
      }
    }
    return _resolvedErrorText;
  }

  function renderError(): void {
    const errorText = getErrorText();
    if (errorText) {
      errorText.content = errorMsg ? ` ${errorMsg}` : '';
    }
    renderer.requestRender();
  }

  // ── Public API ──────────────────────────────────────────────
  const api: InputDialogAPI = {
    focus(): void {
      input.focus();
      renderer.requestRender();
    },

    handleKey(key: KeyEvent): void {
      // Enter — submit（终端实际解析出的名字是 `return`，`enter` 兼容 kitty 键盘协议）
      if (key.name === 'enter' || key.name === 'return') {
        const path = input.value.trim();
        if (!path) {
          errorMsg = '请输入路径';
          renderError();
          return;
        }
        api.destroy();
        onSubmit(path);
        return;
      }

      // Escape — cancel
      if (key.name === 'escape') {
        api.destroy();
        onCancel();
        return;
      }

      // Ctrl+U — clear the whole field（保留原对话框语义；
      // Input 自带的绑定只删到行首）
      if (key.ctrl && key.name === 'u') {
        input.value = '';
        errorMsg = '';
        renderError();
        return;
      }

      input.handleKeyPress(key);

      if (errorMsg) {
        errorMsg = '';
        renderError();
      }
    },

    destroy(): void {
      input.blur();
      const overlayInstance = renderer.root.findDescendantById('sftp-input-overlay');
      if (overlayInstance && overlayInstance.parent) {
        // OpenTUI 0.6：remove() 只接受 renderable 对象，传 id 会抛错
        overlayInstance.parent.remove(overlayInstance);
      }
      input.destroy();
      renderer.requestRender();
    },

    onError(msg: string): void {
      errorMsg = msg;
      renderError();
    },
  };

  return api;
}
