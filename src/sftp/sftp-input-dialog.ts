import { Box, Text, StyledText } from '@opentui/core';
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

/** Create aStyledText with cursor highlight */
function createStyledWithCursor(text: string, pos: number): StyledText {
  const chunks: Array<{
    __isChunk: true;
    text: string;
    fg?: string;
    bg?: string;
    attributes: number;
  }> = [];
  for (let i = 0; i < text.length; i++) {
    if (i === pos) {
      chunks.push({ __isChunk: true, text: text[i], fg: '#1a1b26', bg: C.cursorBg, attributes: 0 });
    } else {
      chunks.push({ __isChunk: true, text: text[i], fg: C.fieldText, attributes: 0 });
    }
  }
  if (pos >= text.length) {
    chunks.push({ __isChunk: true, text: ' ', fg: '#1a1b26', bg: C.cursorBg, attributes: 0 });
  }
  return new StyledText(chunks);
}

/**
 * Create a path input dialog for SFTP upload/download.
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
  let inputValue = '';
  let cursorPos = 0;
  let errorMsg = '';

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
      // Input field
      Box(
        {
          id: 'sftp-input-field',
          flexDirection: 'row',
          height: 1,
          backgroundColor: C.fieldBg,
          border: true,
          borderColor: C.fieldBorder,
          paddingX: 1,
        },
        Text({ content: placeholder, fg: C.labelFg, id: 'sftp-input-text' }),
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

  // ── Resolve real renderables ────────────────────────────────
  let _resolvedInputText: any = null;
  let _resolvedErrorText: any = null;
  let _resolvedField: any = null;

  function getInputText(): any {
    if (!_resolvedInputText) {
      const dialog = renderer.root.findDescendantById('sftp-input-dialog');
      if (dialog) {
        _resolvedInputText = dialog.findDescendantById('sftp-input-text');
      }
    }
    return _resolvedInputText;
  }

  function getErrorText(): any {
    if (!_resolvedErrorText) {
      const dialog = renderer.root.findDescendantById('sftp-input-dialog');
      if (dialog) {
        _resolvedErrorText = dialog.findDescendantById('sftp-input-error');
      }
    }
    return _resolvedErrorText;
  }

  function getField(): any {
    if (!_resolvedField) {
      _resolvedField = renderer.root.findDescendantById('sftp-input-field');
    }
    return _resolvedField;
  }

  // ── Render input field ─────────────────────────────────────
  function renderInput(): void {
    const inputText = getInputText();
    if (!inputText) return;

    const displayText = inputValue || placeholder;
    const fg = inputValue ? C.fieldText : C.labelFg;

    if (inputValue) {
      inputText.content = createStyledWithCursor(inputValue, cursorPos);
    } else {
      inputText.content = placeholder;
      inputText.fg = C.labelFg;
    }

    const field = getField();
    if (field) {
      field.borderColor = C.fieldFocusedBorder;
    }

    renderer.requestRender();
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
      renderInput();
    },

    handleKey(key: KeyEvent): void {
      // Enter — submit
      if (key.name === 'enter') {
        const path = inputValue.trim();
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

      // Backspace — delete char before cursor
      if (key.name === 'backspace') {
        if (cursorPos > 0) {
          inputValue = inputValue.slice(0, cursorPos - 1) + inputValue.slice(cursorPos);
          cursorPos--;
          errorMsg = '';
          renderError();
          renderInput();
        }
        return;
      }

      // Delete — delete char at cursor
      if (key.name === 'delete') {
        if (cursorPos < inputValue.length) {
          inputValue = inputValue.slice(0, cursorPos) + inputValue.slice(cursorPos + 1);
          renderInput();
        }
        return;
      }

      // Arrow keys
      if (key.name === 'left') {
        if (cursorPos > 0) cursorPos--;
        renderInput();
        return;
      }
      if (key.name === 'right') {
        if (cursorPos < inputValue.length) cursorPos++;
        renderInput();
        return;
      }
      if (key.name === 'home') {
        cursorPos = 0;
        renderInput();
        return;
      }
      if (key.name === 'end') {
        cursorPos = inputValue.length;
        renderInput();
        return;
      }

      // Ctrl+U — clear input
      if (key.ctrl && key.name === 'u') {
        inputValue = '';
        cursorPos = 0;
        errorMsg = '';
        renderError();
        renderInput();
        return;
      }

      // Regular character input
      if (key.sequence && !key.ctrl && !key.alt && !key.meta) {
        inputValue += key.sequence;
        cursorPos += key.sequence.length;
        errorMsg = '';
        renderError();
        renderInput();
      }
    },

    destroy(): void {
      const overlay = renderer.root.findDescendantById('sftp-input-overlay');
      if (overlay && overlay.parent) {
        overlay.parent.remove(overlay.id);
      }
      renderer.requestRender();
    },

    onError(msg: string): void {
      errorMsg = msg;
      renderError();
    },
  };

  return api;
}
