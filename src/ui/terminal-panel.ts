import { Box, Text, stringToStyledText, type EmbeddedTerminalRenderable } from '@opentui/core';
import type { CliRenderer } from '@opentui/core';
import { createLogger } from '../logger';

const log = createLogger('terminal-panel');

/**
 * Public API for the terminal panel component.
 *
 * The panel manages visual states (idle, connecting, connected, error,
 * disconnected) and hosts one `EmbeddedTerminalRenderable` per terminal tab.
 * 键盘、粘贴、滚轮、选区、resize 全部由终端 renderable 自己处理，
 * 面板只负责显隐与焦点转移。
 *
 * Access the root component via `.component` to mount it in the render tree.
 */
export interface TerminalPanelAPI {
  /** Root Box renderable — add this to the application layout tree. */
  readonly component: ReturnType<typeof Box>;

  // ── Multi-tab API ──────────────────────────────────────────────────

  /** Mount a terminal renderable for a tab (hidden until switchTerminal). */
  registerTerminal(tabId: string, term: EmbeddedTerminalRenderable): void;

  /** Destroy and remove a terminal renderable for a tab. */
  unregisterTerminal(tabId: string): void;

  /** Switch the visible terminal to the given tab. */
  switchTerminal(tabId: string): void;

  /** Get the currently active tab id. */
  getActiveTabId(): string | null;

  // ── State management ───────────────────────────────────────────────

  /** Give keyboard focus to the active terminal. */
  focus(): void;

  /** Show the idle placeholder: "← Select a connection to begin". */
  showIdle(): void;

  /** Show the "Connecting to {host}..." state. */
  showConnecting(host: string): void;

  /** Show the connected state — terminal output area is visible. */
  showConnected(host: string): void;

  /** Show a centered red error message. */
  showError(message: string): void;

  /** Show the yellow "Connection closed" state. */
  showDisconnected(): void;

  /** Set visual focus highlight (border color) and blur the terminal when false. */
  setFocused(value: boolean): void;

  /** Show or hide the terminal panel. */
  setVisible(visible: boolean): void;
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
  // ── Shared styling constants ──────────────────────────────────────────
  // Tokyo Night palette
  const C = {
    bg: '#1a1b26',
    textDim: '#565f89',
    yellow: '#e0af68',
    red: '#f7768e',
  };

  const overlayProps = {
    flexDirection: 'column' as const,
    justifyContent: 'center' as const,
    alignItems: 'center' as const,
    width: '100%' as const,
    height: '100%' as const,
  };

  // ── State containers (VNode proxies — resolved after mounting) ────────

  // 1. Idle
  const idleBox = Box(
    overlayProps,
    Text({ content: '\u2190 Select a connection to begin', fg: C.textDim }),
  );

  // 2. Connecting
  const connectingText = Text({ content: 'Connecting\u2026', fg: C.yellow });
  const connectingBox = Box(overlayProps, connectingText);

  // 3. Connected – hosts one EmbeddedTerminalRenderable per tab
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
      borderStyle: 'rounded',
      borderColor: '#3b4261',
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

  // ── Multi-tab terminal tracking ──────────────────────────────────────
  const terminals = new Map<string, EmbeddedTerminalRenderable>();
  let activeTabId: string | null = null;

  // ── Public API ────────────────────────────────────────────────────────
  return {
    component: container,

    registerTerminal(tabId: string, term: EmbeddedTerminalRenderable): void {
      log.debug(`[TERMINAL PANEL] registerTerminal: tabId=${tabId}`);
      const r = resolve();
      if (r) {
        r.connected.add(term);
        // Hide by default — switchTerminal will show the active one.
        // 注意：visible=false 的节点不参与布局，所以隐藏的 tab 不会被 resize，
        // 切回来时才拿到真实行列数（并由 onTerminalResize 同步远端 PTY）。
        term.visible = false;
      }
      terminals.set(tabId, term);
      log.debug(`[TERMINAL PANEL] registerTerminal: terminals count now=${terminals.size}`);
    },

    unregisterTerminal(tabId: string): void {
      log.debug(`[TERMINAL PANEL] unregisterTerminal: tabId=${tabId}`);
      const term = terminals.get(tabId);
      if (!term) return;
      try {
        term.destroy();
      } catch (err) {
        log.debug(`[TERMINAL PANEL] unregisterTerminal: destroy error: ${err}`);
      }
      terminals.delete(tabId);
      if (activeTabId === tabId) activeTabId = null;
      renderer.requestRender();
      log.debug(`[TERMINAL PANEL] unregisterTerminal: terminals count now=${terminals.size}`);
    },

    switchTerminal(tabId: string): void {
      log.debug(`[TERMINAL PANEL] switchTerminal: tabId=${tabId}, current=${activeTabId}`);
      const r = resolve();
      if (!r) return;

      for (const [id, term] of terminals) {
        term.visible = id === tabId;
      }

      activeTabId = tabId;
      showOnly(r.connected);
    },

    getActiveTabId: () => activeTabId,

    focus(): void {
      const term = activeTabId ? terminals.get(activeTabId) : null;
      if (term) term.focus();
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

    setFocused(value: boolean): void {
      const r = resolve();
      if (r) r.container.borderColor = value ? '#7aa2f7' : '#3b4261';
      if (!value) {
        // 离开终端时释放键盘焦点，避免后台 tab 继续收键
        for (const term of terminals.values()) term.blur();
      }
      renderer.requestRender();
    },

    setVisible(visible: boolean): void {
      const r = resolve();
      if (r) r.container.visible = visible;
    },
  };
}
