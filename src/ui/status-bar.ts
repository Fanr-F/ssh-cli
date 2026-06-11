import { Box, Text } from '@opentui/core';
import type { CliRenderer } from '@opentui/core';

// ── Tokyo Night palette ───────────────────────────────────────
const C = {
  surface: '#16161e',
  border: '#3b4261',
  text: '#c0caf5',
  textDim: '#565f89',
  green: '#9ece6a',
  red: '#f7768e',
  yellow: '#e0af68',
  cyan: '#7dcfff',
};

export interface StatusBarAPI {
  setStatus(text: string): void;
  setConnected(host: string): void;
  setDisconnected(): void;
  setKeybindings(hints: string[]): void;
}

export function createStatusBar(renderer: CliRenderer): StatusBarAPI {
  const statusText = Text({
    content: 'Disconnected',
    fg: C.textDim,
  });

  const hintsText = Text({
    content: '',
    fg: C.textDim,
  });

  const statusBar = Box(
    {
      id: 'status-bar',
      position: 'absolute',
      bottom: 0,
      width: '100%',
      height: 1,
      backgroundColor: C.surface,
      border: true,
      borderColor: C.border,
      flexDirection: 'row',
      justifyContent: 'space-between',
      paddingX: 1,
    },
    statusText,
    hintsText,
  );

  renderer.root.add(statusBar);

  // Box() returns a Proxy — property sets on it go nowhere after instantiation.
  // Resolve the real Text renderables via the parent's getChildren().
  let _resolvedStatusText: any = null;
  let _resolvedHintsText: any = null;
  function getStatusText(): any {
    if (!_resolvedStatusText) {
      const bar = renderer.root.findDescendantById('status-bar');
      if (bar) {
        const children = bar.getChildren();
        if (children.length > 0) _resolvedStatusText = children[0];
      }
    }
    return _resolvedStatusText;
  }
  function getHintsText(): any {
    if (!_resolvedHintsText) {
      const bar = renderer.root.findDescendantById('status-bar');
      if (bar) {
        const children = bar.getChildren();
        if (children.length > 1) _resolvedHintsText = children[1];
      }
    }
    return _resolvedHintsText;
  }

  return {
    setStatus(text: string): void {
      const st = getStatusText();
      if (st) { st.content = text; st.fg = C.text; }
    },

    setConnected(host: string): void {
      const st = getStatusText();
      if (st) { st.content = `Connected to ${host}`; st.fg = C.green; }
    },

    setDisconnected(): void {
      const st = getStatusText();
      if (st) { st.content = 'Disconnected'; st.fg = C.textDim; }
    },

    setKeybindings(hints: string[]): void {
      const ht = getHintsText();
      if (ht) ht.content = hints.join('  ');
    },
  };
}
