import { Box, Text } from '@opentui/core';
import type { CliRenderer, MouseEvent } from '@opentui/core';

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

export function createToolbar(
  _renderer: CliRenderer,
  callbacks: ToolbarCallbacks,
): ReturnType<typeof Box> {
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

  const sbText = Text({ content: ' sidebar ', fg: C.textDim });
  const tabText = Text({ content: ' tab ', fg: C.cyan });
  const termText = Text({ content: ' terminal ', fg: C.textDim });
  const sep1 = Text({ content: '│', fg: C.textMuted });
  const sep2 = Text({ content: '│', fg: C.textMuted });

  focusHint.add(sbText);
  focusHint.add(sep1);
  focusHint.add(tabText);
  focusHint.add(sep2);
  focusHint.add(termText);
  toolbar.add(focusHint);

  return toolbar;
}
