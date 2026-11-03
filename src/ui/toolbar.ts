import { Box, Text } from '@opentui/core';
import type { CliRenderer, MouseEvent } from '@opentui/core';
import { BINDINGS, formatKeys, type FocusZone } from '../keymap';
import { theme } from '../theme';

// ── Tokyo Night palette ───────────────────────────────────────
const C = {
  surface: theme.appBg,
  border: theme.border,
  red: theme.red,
  green: theme.green,
  yellow: theme.yellow,
  blue: theme.accent,
  magenta: theme.magenta,
  cyan: theme.cyan,
  textDim: theme.textDim,
  textMuted: theme.textMuted,
};

/** Format a binding's key(s) for display; the binding table is the source. */
export function bindingShortcut(id: string): string {
  const binding = BINDINGS.find((entry) => entry.id === id);
  if (!binding) return '?';
  return formatKeys(binding.key, binding.keys);
}

export interface ToolbarCallbacks {
  onNew?: () => void;
  onEdit?: () => void;
  onDelete?: () => void;
  onConnect?: () => void;
  onQuit?: () => void;
  onHelp?: () => void;
}

export interface ToolbarAPI {
  component: ReturnType<typeof Box>;
  /** 高亮当前焦点区域（与 App 的 focus 状态保持一致） */
  setFocus(zone: FocusZone): void;
}

const FOCUS_LABELS: Array<{ zone: FocusZone; label: string }> = [
  { zone: 'sidebar', label: ' sidebar ' },
  { zone: 'terminal', label: ' terminal ' },
  { zone: 'sftp', label: ' sftp ' },
  { zone: 'form', label: ' form ' },
];

export function createToolbar(
  renderer: CliRenderer,
  callbacks: ToolbarCallbacks,
): ToolbarAPI {
  const toolbar = Box({
    id: 'toolbar',
    flexDirection: 'row',
    width: '100%',
    height: 1,
    backgroundColor: C.surface,
    paddingX: 1,
    alignItems: 'center',
  });

  // Leading accent bar
  const accentBar = Box({
    width: 3,
    height: '100%',
    backgroundColor: C.cyan,
  });
  toolbar.add(accentBar);

  // Labels' shortcut hints come from src/keymap/bindings.ts (single source).
  const items = [
    { label: 'new', binding: 'sidebar.add', action: () => callbacks.onNew?.(), color: C.green },
    { label: 'edit', binding: 'sidebar.edit', action: () => callbacks.onEdit?.(), color: C.yellow },
    { label: 'connect', binding: 'sidebar.connect', action: () => callbacks.onConnect?.(), color: C.blue },
    { label: 'delete', binding: 'sidebar.delete', action: () => callbacks.onDelete?.(), color: C.red },
    { label: 'quit', binding: 'app.quit', action: () => callbacks.onQuit?.(), color: C.magenta },
    { label: 'help', binding: 'help.toggle', action: () => callbacks.onHelp?.(), color: C.cyan },
  ];

  for (const item of items) {
    const btn = Box({
      paddingX: 1,
      onMouseDown: (e: MouseEvent) => {
        e.stopPropagation();
        item.action();
      },
    });

    const labelText = Text({ content: ` ${item.label}`, fg: item.color });
    const keyText = Text({ content: `[${bindingShortcut(item.binding)}]`, fg: C.textMuted });
    btn.add(labelText);
    btn.add(keyText);
    toolbar.add(btn);
  }

  // Spacer
  toolbar.add(Box({ flexGrow: 1 }));

  // Focus mode indicator
  const focusHint = Box({ paddingX: 1 });
  for (let i = 0; i < FOCUS_LABELS.length; i++) {
    if (i > 0) focusHint.add(Text({ content: '│', fg: C.textMuted }));
    focusHint.add(
      Text({
        id: `focus-${FOCUS_LABELS[i].zone}`,
        content: FOCUS_LABELS[i].label,
        fg: C.textDim,
      }),
    );
  }
  toolbar.add(focusHint);

  const resolved = new Map<FocusZone, any>();

  return {
    component: toolbar,

    setFocus(zone: FocusZone): void {
      for (const { zone: labelZone } of FOCUS_LABELS) {
        let node = resolved.get(labelZone);
        if (!node) {
          node = renderer.root.findDescendantById(`focus-${labelZone}`);
          if (node) resolved.set(labelZone, node);
        }
        if (node) node.fg = labelZone === zone ? C.cyan : C.textDim;
      }
      renderer.requestRender();
    },
  };
}
