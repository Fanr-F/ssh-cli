import { Box, Text, stringToStyledText } from '@opentui/core';
import type { CliRenderer, KeyEvent, MouseEvent } from '@opentui/core';
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

  /** Update terminal content in-place (no remove/add, updates resolved Text renderables). */
  updateTerminalContent(): boolean;

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

  /**
   * Register a callback for mouse scroll events.
   * Receives the scroll direction: "up" or "down".
   */
  onScroll(callback: (direction: 'up' | 'down') => void): void;

  /** Set the focusable state on the real renderable (Proxy-safe). */
  setFocusable(value: boolean): void;
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
  let scrollCallback: ((direction: 'up' | 'down') => void) | null = null;

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

  // ── State containers (VNode proxies — used only at construction) ──────

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
    id: 'terminal-connected',
    width: '100%',
    height: '100%',
    flexDirection: 'column',
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
      id: 'terminal-panel',
      flexGrow: 1,
      backgroundColor: C.bg,
      onKeyDown: (key: KeyEvent) => {
        if (keyCallback) {
          keyCallback(key.sequence);
          key.preventDefault();
        }
      },
      onMouseScroll: (e: MouseEvent) => {
        if (scrollCallback && e.scroll) {
          scrollCallback(e.scroll.direction);
          e.preventDefault();
        }
      },
    },
    idleBox,
    connectingBox,
    connectedBox,
    errorBox,
    disconnectedBox,
  );

  // ── Resolve real renderable instances after mounting ──────────────────
  // Box() returns a Proxy. After instantiation, property sets (visible,
  // content) and method calls (add, remove, focus) on the Proxy go nowhere.
  // We resolve the real renderable instances once the tree is mounted.

  interface ResolvedInstances {
    container: any;
    idle: any;
    connecting: any;
    connected: any;
    error: any;
    disconnected: any;
  }
  let resolved: ResolvedInstances | null = null;

  function resolve(): ResolvedInstances | null {
    if (resolved) return resolved;
    const c = renderer.root.findDescendantById('terminal-panel');
    if (!c) return null;
    const children = c.getChildren();
    // Children are in the order they were added: idle, connecting, connected, error, disconnected
    if (children.length < 5) return null;
    resolved = {
      container: c,
      idle: children[0],
      connecting: children[1],
      connected: children[2],
      error: children[3],
      disconnected: children[4],
    };
    // Set initial visibility — only idle is visible
    resolved.idle.visible = true;
    resolved.connecting.visible = false;
    resolved.connected.visible = false;
    resolved.error.visible = false;
    resolved.disconnected.visible = false;
    return resolved;
  }

  // ── Helper: show exactly one overlay ──────────────────────────────────
  function showOnly(target: any): void {
    const r = resolve();
    if (!r) return;
    r.idle.visible = target === r.idle;
    r.connecting.visible = target === r.connecting;
    r.connected.visible = target === r.connected;
    r.error.visible = target === r.error;
    r.disconnected.visible = target === r.disconnected;
    renderer.requestRender();
  }

  // ── Terminal content child tracking ──────────────────────────────────
  const TERMINAL_CONTENT_ID = 'terminal-content';
  let hasTerminalContent = false;

  // ── Public API ────────────────────────────────────────────────────────
  return {
    component: container,

    setTerminalRenderer(r: TerminalRenderer): void {
      terminalRenderer = r;
    },

    setTerminalContent(node: ReturnType<typeof Box>): void {
      const r = resolve();
      if (!r) return;
      // Remove previous terminal content if any
      if (hasTerminalContent) {
        r.connected.remove(TERMINAL_CONTENT_ID);
      }
      r.connected.add(node);
      hasTerminalContent = true;
      // Resolve children for in-place updates
      if (terminalRenderer) {
        const children = r.connected.getChildren();
        terminalRenderer.resolveChildren(children);
      }
      renderer.requestRender();
    },

    updateTerminalContent(): boolean {
      if (!terminalRenderer) return false;
      const ok = terminalRenderer.updateContent();
      if (ok) renderer.requestRender();
      return ok;
    },

    focus(): void {
      const r = resolve();
      if (r) r.container.focus();
      renderer.requestRender();
    },

    showIdle(): void {
      const r = resolve();
      if (r) showOnly(r.idle);
    },

    showConnecting(host: string): void {
      const r = resolve();
      if (!r) return;
      // Update the connecting text on the real renderable
      const textChildren = r.connecting.getChildren();
      if (textChildren.length > 0) {
        textChildren[0].content = stringToStyledText(`Connecting to ${host}\u2026`);
      }
      showOnly(r.connecting);
    },

    showConnected(_host: string): void {
      const r = resolve();
      if (r) showOnly(r.connected);
    },

    showError(message: string): void {
      const r = resolve();
      if (!r) return;
      const textChildren = r.error.getChildren();
      if (textChildren.length > 0) {
        textChildren[0].content = stringToStyledText(message);
      }
      showOnly(r.error);
    },

    showDisconnected(): void {
      const r = resolve();
      if (r) showOnly(r.disconnected);
    },

    onKeyInput(callback: (key: string) => void): void {
      keyCallback = callback;
    },

    onScroll(callback: (direction: 'up' | 'down') => void): void {
      scrollCallback = callback;
    },

    setFocusable(value: boolean): void {
      const r = resolve();
      if (r) r.container.focusable = value;
    },
  };
}
