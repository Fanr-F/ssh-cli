import { EmbeddedTerminalRenderable } from '@opentui/core';
import type { CliRenderer } from '@opentui/core';
import { logIO } from '../logger';
import type { SshConnection } from '../ssh/connection';

export interface TerminalTabOptions {
  renderer: CliRenderer;
  tabId: string;
  cols: number;
  rows: number;
  ssh: Pick<SshConnection, 'writeToShell' | 'resizePty'>;
  /** Right-click is paste, so the app needs to take focus first. */
  onRightClickPaste: () => void;
}

/** Create the native Ghostty terminal used by one terminal tab. */
export function createTerminalRenderable(
  options: TerminalTabOptions,
): EmbeddedTerminalRenderable {
  const { renderer, tabId, cols, rows, ssh, onRightClickPaste } = options;

  const term = new EmbeddedTerminalRenderable(renderer as any, {
    id: `tab-terminal-${tabId}`,
    width: '100%',
    height: '100%',
    cols,
    rows,
    // Unit is bytes; 10000 is too small for long-running shells.
    maxScrollback: 200_000,
    // Use the panel background (Tokyo Night) instead of native black.
    transparentBackground: true,
    selectable: true,
  });

  // Keyboard input and terminal replies (DSR/DA…) go back to the remote.
  term.onData = (data, _source) => {
    const text = Buffer.from(data).toString('utf8');
    if (!text) return;
    logIO('OUT', text);
    ssh.writeToShell(text);
  };
  // Yoga layout size → remote PTY.
  term.onTerminalResize = (c, r) => ssh.resizePty(c, r);

  // EmbeddedTerminalRenderable.setupMouse() wraps the mouse handler so it
  // forwards to the remote first. Right-click stays local for paste; every
  // other button keeps the built-in forwarding/selection behaviour.
  const termAny = term as any;
  const forwardMouse = termAny.forwardMouse.bind(term);
  term.onMouseDown = (e) => {
    if (e.button === 2) {
      e.preventDefault();
      e.stopPropagation();
      onRightClickPaste();
      return;
    }
    forwardMouse(e, 'press');
  };
  term.onMouseUp = (e) => {
    if (e.button === 2) {
      e.preventDefault();
      e.stopPropagation();
      return;
    }
    forwardMouse(e, 'release');
  };

  return term;
}
