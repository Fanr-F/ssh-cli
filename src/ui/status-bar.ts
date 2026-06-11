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

  // Cast to access properties directly
  const st = statusText as unknown as { content: string; fg: string };
  const ht = hintsText as unknown as { content: string };

  return {
    setStatus(text: string): void {
      st.content = text;
      st.fg = C.text;
    },

    setConnected(host: string): void {
      st.content = `Connected to ${host}`;
      st.fg = C.green;
    },

    setDisconnected(): void {
      st.content = 'Disconnected';
      st.fg = C.textDim;
    },

    setKeybindings(hints: string[]): void {
      ht.content = hints.join('  ');
    },
  };
}
