import { Box, Text, stringToStyledText } from '@opentui/core';
import type { CliRenderer, KeyEvent } from '@opentui/core';
import { TerminalRenderer } from '../terminal/terminal-renderer';

/**
 * Public API for the terminal panel component.
 *
 * The panel manages visual states (idle, connecting, connected, error,
 * disconnected) and forwards keyboard input while connected.
 *
 * Access the root component via `.component` to mount it in the render tree.
 */
export interface TerminalPanelAPI {
  /** Root Box renderable — add this to the application layout tree. */
  readonly component: ReturnType<typeof Box>;

  /** Attach a TerminalRenderer to use when the connected state is active. */
  setTerminalRenderer(renderer: TerminalRenderer): void;

  /** Replace the connected-state content with the given Box tree. */
  setTerminalContent(node: ReturnType<typeof Box>): void;

  /** Give keyboard focus to this panel. */
  focus(): void;

  /** Show the idle placeholder: "← Select a connection to begin". */
  showIdle(): void;

  /** Show the "Connecting to {host}..." state. */
  showConnecting(host: string): void;

  /** Show the connected state — terminal output area is visible and empty. */
  showConnected(host: string): void;

  /** Show a centered red error message. */
  showError(message: string): void;

  /** Show the yellow "Connection closed" state. */
  showDisconnected(): void;

  /**
   * Register a callback that receives every raw key sequence the panel
   * receives while it has keyboard focus. Used by the app bridge to
   * forward keystrokes to the SSH channel.
   */
  onKeyInput(callback: (key: string) => void): void;
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Create the terminal panel component.
 *
 * @param renderer – The active CLI renderer (used for `requestRender()`).
 */
export function createTerminalPanel(renderer: CliRenderer): TerminalPanelAPI {
  let terminalRenderer: TerminalRenderer | null = null;
  let keyCallback: ((key: string) => void) | null = null;

  // ── Shared styling constants ──────────────────────────────────────────
  // Tokyo Night palette
  const C = {
    bg: '#1a1b26',
    textDim: '#565f89',
    yellow: '#e0af68',
    red: '#f7768e',
    cyan: '#7dcfff',
  };

  const overlayProps = {
    flexDirection: 'column' as const,
    justifyContent: 'center' as const,
    alignItems: 'center' as const,
    width: '100%' as const,
    height: '100%' as const,
  };

  // ── State containers ──────────────────────────────────────────────────

  // 1. Idle
  const idleBox = Box(
    overlayProps,
    Text({ content: '\u2190 Select a connection to begin', fg: C.textDim }),
  );

  // 2. Connecting
  const connectingText = Text({ content: 'Connecting\u2026', fg: C.yellow });
  const connectingBox = Box(overlayProps, connectingText);

  // 3. Connected – empty terminal area
  const connectedBox = Box({
    width: '100%',
    height: '100%',
  });

  // 4. Error
  const errorText = Text({ content: '', fg: C.red });
  const errorBox = Box(overlayProps, errorText);

  // 5. Disconnected
  const disconnectedBox = Box(
    overlayProps,
    Text({ content: 'Connection closed', fg: C.yellow }),
  );

  // ── Root container ────────────────────────────────────────────────────
  const container = Box(
    {
      flexGrow: 1,
      backgroundColor: C.bg,
      onKeyDown: (key: KeyEvent) => {
        if (keyCallback) {
          keyCallback(key.sequence);
          key.preventDefault();
        }
      },
    },
    idleBox,
    connectingBox,
    connectedBox,
    errorBox,
    disconnectedBox,
  );

  // Only idle is visible initially.
  idleBox.visible = true;
  connectingBox.visible = false;
  connectedBox.visible = false;
  errorBox.visible = false;
  disconnectedBox.visible = false;

  // ── Helper: show exactly one overlay ──────────────────────────────────
  function showOnly(box: typeof idleBox): void {
    idleBox.visible = box === idleBox;
    connectingBox.visible = box === connectingBox;
    connectedBox.visible = box === connectedBox;
    errorBox.visible = box === errorBox;
    disconnectedBox.visible = box === disconnectedBox;
    renderer.requestRender();
  }

  // ── Terminal content child tracking ──────────────────────────────────
  /** The id of the Box child that holds the current terminal renderer output. */
  let terminalContentId: string | null = null;

  // ── Public API ────────────────────────────────────────────────────────
  return {
    component: container,

    setTerminalRenderer(r: TerminalRenderer): void {
      terminalRenderer = r;
    },

    setTerminalContent(node: ReturnType<typeof Box>): void {
      // Remove previous terminal content if any
      if (terminalContentId) {
        try { connectedBox.remove(terminalContentId); } catch (err) {
          // Child may not exist in tree yet
        }
      }
      connectedBox.add(node);
      terminalContentId = node.id ?? null;
      renderer.requestRender();
    },

    focus(): void {
      container.focus();
      renderer.requestRender();
    },

    showIdle(): void {
      showOnly(idleBox);
    },

    showConnecting(host: string): void {
      connectingText.content = stringToStyledText(`Connecting to ${host}\u2026`);
      showOnly(connectingBox);
    },

    showConnected(_host: string): void {
      showOnly(connectedBox);
    },

    showError(message: string): void {
      errorText.content = stringToStyledText(message);
      showOnly(errorBox);
    },

    showDisconnected(): void {
      showOnly(disconnectedBox);
    },

    onKeyInput(callback: (key: string) => void): void {
      keyCallback = callback;
    },
  };
}
