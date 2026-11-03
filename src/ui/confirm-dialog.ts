import { BoxRenderable, TextRenderable } from '@opentui/core';
import type { CliRenderer, KeyEvent, MouseEvent, RenderContext } from '@opentui/core';
import { theme } from '../theme';
import { findBinding, normalizeKey, type KeyContext } from '../keymap';

/** Description of a confirmation request; the resolver lives in the callback. */
export interface ConfirmRequest {
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  /** Render the confirm button in the danger colour. */
  danger?: boolean;
}

export interface ConfirmDialogOptions extends ConfirmRequest {
  onResolve: (confirmed: boolean) => void;
}

export interface ConfirmDialogAPI {
  readonly component: BoxRenderable;
  /** Route a raw key event while the dialog is open. */
  handleKey(key: KeyEvent): void;
  /** Remove the dialog from the render tree. */
  destroy(): void;
}

const C = {
  overlayBg: theme.overlay,
  surfaceBg: theme.appBg,
  border: theme.border,
  focusBorder: theme.focusBorder,
  title: theme.accent,
  text: theme.text,
  textDim: theme.textDim,
  danger: theme.red,
  dialogWidth: 56,
} as const;

/**
 * Modal confirmation dialog.
 *
 * The safe choice (Cancel) owns the initial focus, so a stray Enter never
 * performs a destructive action. Keys are routed by `App` through the shared
 * keymap (`confirm.*` bindings); the dialog itself only resolves the request.
 */
export function createConfirmDialog(
  renderer: CliRenderer,
  options: ConfirmDialogOptions,
): ConfirmDialogAPI {
  const ctx = renderer as unknown as RenderContext;
  let focusedButton = 0; // 0 = Cancel, 1 = Confirm
  let settled = false;

  const overlay = new BoxRenderable(ctx, {
    id: 'confirm-overlay',
    position: 'absolute',
    top: 0,
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: C.overlayBg,
    alignItems: 'center',
    justifyContent: 'center',
    focusable: true,
    onMouseDown: (e: MouseEvent) => {
      // Never let a click reach the form / sidebar behind the modal.
      e.preventDefault();
      e.stopPropagation();
    },
  });

  const dialog = new BoxRenderable(ctx, {
    id: 'confirm-dialog',
    flexDirection: 'column',
    border: true,
    borderColor: C.border,
    backgroundColor: C.surfaceBg,
    width: C.dialogWidth,
    minWidth: C.dialogWidth,
    padding: 1,
    title: `  ${options.title}  `,
    titleColor: C.title,
    titleAlignment: 'center',
  });
  overlay.add(dialog);

  const message = new TextRenderable(ctx, {
    id: 'confirm-message',
    content: ` ${options.message}`,
    fg: C.text,
    width: '100%',
  });
  dialog.add(message);

  const buttonRow = new BoxRenderable(ctx, {
    id: 'confirm-buttons',
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 2,
    marginTop: 1,
  });
  dialog.add(buttonRow);

  function button(label: string, fg: string, onActivate: () => void) {
    const box = new BoxRenderable(ctx, {
      border: true,
      borderColor: C.border,
      paddingX: 2,
      paddingY: 0,
      onMouseDown: (e: MouseEvent) => {
        e.preventDefault();
        e.stopPropagation();
        if (e.button === 2) return;
        onActivate();
      },
    });
    box.add(new TextRenderable(ctx, { content: ` ${label} `, fg }));
    buttonRow.add(box);
    return box;
  }

  const cancelBox = button(options.cancelLabel ?? 'Cancel', C.textDim, () => settle(false));
  const confirmBox = button(
    options.confirmLabel ?? 'Confirm',
    options.danger ? C.danger : C.text,
    () => settle(true),
  );

  function updateFocus(): void {
    cancelBox.borderColor = focusedButton === 0 ? C.focusBorder : C.border;
    confirmBox.borderColor = focusedButton === 1 ? C.focusBorder : C.border;
  }

  function settle(confirmed: boolean): void {
    if (settled) return;
    settled = true;
    options.onResolve(confirmed);
  }

  function moveFocus(dir: 1 | -1): void {
    focusedButton = (focusedButton + dir + 2) % 2;
    updateFocus();
    renderer.requestRender();
  }

  function handleKey(key: KeyEvent): void {
    if (settled) return;

    const k = normalizeKey(key);
    const keyCtx: KeyContext = {
      focus: 'form',
      helpOpen: false,
      formOpen: false,
      confirmOpen: true,
      sftpCmdMode: false,
      formField: -1,
      activeTabType: null,
    };
    const binding = findBinding('confirm', k, keyCtx);

    switch (binding?.id) {
      case 'confirm.cancel':
        key.preventDefault();
        settle(false);
        return;
      case 'confirm.confirm':
        key.preventDefault();
        settle(focusedButton === 1);
        return;
      case 'confirm.next':
        key.preventDefault();
        moveFocus(1);
        return;
      case 'confirm.prev':
        key.preventDefault();
        moveFocus(-1);
        return;
      default:
        // Modal: unmatched keys are deliberately swallowed by the caller.
        return;
    }
  }

  function destroy(): void {
    settled = true;
    if (overlay.parent) {
      overlay.parent.remove(overlay);
    }
    renderer.requestRender();
  }

  updateFocus();
  renderer.root.add(overlay);

  return {
    component: overlay,
    handleKey,
    destroy,
  };
}
