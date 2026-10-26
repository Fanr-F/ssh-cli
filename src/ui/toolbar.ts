import { Box, Text } from '@opentui/core';
import type { CliRenderer, MouseEvent } from '@opentui/core';
import type { FocusZone } from '../keymap';

// ── Tokyo Night palette ───────────────────────────────────────
const C = {
  surface: '#16161e',
  border: '#3b4261',
  red: '#f7768e',
  green: '#9ece6a',
  yellow: '#e0af68',
  blue: '#7aa2f7',
  magenta: '#bb9af7',
  cyan: '#7dcfff',
  textDim: '#565f89',
  textMuted: '#414868',
};

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

  const items = [
    { label: 'new [a]', key: 'a', action: () => callbacks.onNew?.(), color: C.green },
    { label: 'edit [e]', key: 'e', action: () => callbacks.onEdit?.(), color: C.yellow },
    { label: 'connect [enter]', key: '↵', action: () => callbacks.onConnect?.(), color: C.blue },
    { label: 'delete [del]', key: '⌫', action: () => callbacks.onDelete?.(), color: C.red },
    { label: 'quit [^q]', key: '^q', action: () => callbacks.onQuit?.(), color: C.magenta },
    { label: 'help [f1]', key: 'f1', action: () => callbacks.onHelp?.(), color: C.cyan },
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
    const keyText = Text({ content: `[${item.key}]`, fg: C.textMuted });
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
