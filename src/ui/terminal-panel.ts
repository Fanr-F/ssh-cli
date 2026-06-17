import { Box, Text, stringToStyledText } from '@opentui/core';
import type { CliRenderer, KeyEvent, MouseEvent } from '@opentui/core';
import { TerminalRenderer } from '../terminal/terminal-renderer';
import { createLogger } from '../logger';

const log = createLogger('terminal-panel');

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

  // ── Multi-tab API ──────────────────────────────────────────────────

  /** Register a terminal renderer for a tab. Returns a content Box to mount. */
  registerTerminal(tabId: string, r: TerminalRenderer, rows: number): ReturnType<typeof Box>;

  /** Unregister and remove a terminal renderer for a tab. */
  unregisterTerminal(tabId: string): void;

  /** Switch the visible terminal to the given tab. */
  switchTerminal(tabId: string): void;

  /** Get the currently active tab id. */
  getActiveTabId(): string | null;

  /** Update terminal content for a specific tab. */
  updateTerminalContentForTab(tabId: string): boolean;

  // ── State management ───────────────────────────────────────────────

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

  /** Set visual focus highlight (changes border color). */
  setFocused(value: boolean): void;
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
      borderStyle: 'rounded',
      borderColor: '#3b4261',
      onKeyDown: (key: KeyEvent) => {
        if (keyCallback) {
          keyCallback(key.sequence);
          key.preventDefault();
        }
      },
      onMouseScroll: (e: MouseEvent) => {
        if (scrollCallback && e.scroll) {
          log.debug(`[TERMINAL PANEL] onMouseScroll: direction=${e.scroll.direction}, deltaY=${e.scroll.deltaY}`);
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

  // ── Multi-tab terminal tracking ──────────────────────────────────────
  interface TerminalEntry {
    renderer: TerminalRenderer;
    contentBox: ReturnType<typeof Box>;
    resolvedChildren: any[];
  }
  const terminals = new Map<string, TerminalEntry>();
  let activeTabId: string | null = null;

  // ── Terminal content child tracking (legacy single-tab) ─────────────
  let hasTerminalContent = false;
  let lastAddedContentBox: ReturnType<typeof Box> | null = null;

  // ── Public API ────────────────────────────────────────────────────────
  return {
    component: container,

    registerTerminal(tabId: string, r: TerminalRenderer, rows: number): ReturnType<typeof Box> {
      log.debug(`[TERMINAL PANEL] registerTerminal: tabId=${tabId}, rows=${rows}`);
      // Use a unique id per tab so we can find the real renderable later
      const contentBox = r.createContentBox(rows, `tab-content-${tabId}`);
      terminals.set(tabId, { renderer: r, contentBox, resolvedChildren: [] });

      // Add directly to connected box (multi-tab: each tab owns its own contentBox)
      const resolved = resolve();
      if (resolved) {
        resolved.connected.add(contentBox);
        // Hide by default — switchTerminal will show the active one
        contentBox.visible = false;
        log.debug(`[TERMINAL PANEL] registerTerminal: added contentBox to connected, hidden by default`);
      }

      log.debug(`[TERMINAL PANEL] registerTerminal: terminals count now=${terminals.size}, terminals keys=[${[...terminals.keys()].join(', ')}]`);
      return contentBox;
    },

    unregisterTerminal(tabId: string): void {
      log.debug(`[TERMINAL PANEL] unregisterTerminal: tabId=${tabId}`);
      const entry = terminals.get(tabId);
      if (!entry) {
        log.debug(`[TERMINAL PANEL] unregisterTerminal: entry not found for ${tabId}`);
        return;
      }
      const r = resolve();
      if (r) {
        // Find and remove by iterating children (more reliable than findDescendantById)
        const children = r.connected.getChildren() ?? [];
        log.debug(`[TERMINAL PANEL] unregisterTerminal: connected has ${children.length} children`);
        for (let i = children.length - 1; i >= 0; i--) {
          const child = children[i];
          const childId = child?.id ?? '';
          log.debug(`[TERMINAL PANEL] unregisterTerminal: checking child ${i} id=${childId}`);
          if (childId === `tab-content-${tabId}`) {
            log.debug(`[TERMINAL PANEL] unregisterTerminal: removing child ${i} (tab-content-${tabId})`);
            try { 
              r.connected.remove(childId); 
              log.debug(`[TERMINAL PANEL] unregisterTerminal: successfully removed`);
            } catch (err) {
              log.debug(`[TERMINAL PANEL] unregisterTerminal: error removing: ${err}`);
            }
            break;
          }
        }
      }
      terminals.delete(tabId);
      if (activeTabId === tabId) {
        log.debug(`[TERMINAL PANEL] unregisterTerminal: was active tab, setting activeTabId=null`);
        activeTabId = null;
      }
      // Reset terminal content tracking since we removed the content
      hasTerminalContent = false;
      lastAddedContentBox = null;
      log.debug(`[TERMINAL PANEL] unregisterTerminal: terminals count now=${terminals.size}`);
      renderer.requestRender();
    },

    switchTerminal(tabId: string): void {
      log.debug(`[TERMINAL PANEL] switchTerminal: tabId=${tabId}, current activeTabId=${activeTabId}`);
      const r = resolve();
      if (!r) {
        log.debug(`[TERMINAL PANEL] switchTerminal: resolve() returned null`);
        return;
      }

      log.debug(`[TERMINAL PANEL] switchTerminal: terminals count=${terminals.size}`);
      log.debug(`[TERMINAL PANEL] switchTerminal: terminals keys=[${[...terminals.keys()].join(', ')}]`);
      
      // Log connected children
      const connectedChildren = r.connected.getChildren() ?? [];
      log.debug(`[TERMINAL PANEL] switchTerminal: connected has ${connectedChildren.length} children`);
      for (let i = 0; i < connectedChildren.length; i++) {
        const child = connectedChildren[i];
        log.debug(`[TERMINAL PANEL] switchTerminal: child ${i} id=${child?.id ?? 'unknown'}`);
      }

      // Hide all terminals — must use REAL renderables, not VNode proxies
      for (const [id, entry] of terminals) {
        const shouldShow = id === tabId;
        log.debug(`[TERMINAL PANEL] switchTerminal: setting tab ${id} visible=${shouldShow}`);
        // Find the REAL renderable by id
        const realBox = renderer.root.findDescendantById(`tab-content-${id}`);
        if (realBox) {
          log.debug(`[TERMINAL PANEL] switchTerminal: found real renderable for ${id}`);
          realBox.visible = shouldShow;
        } else {
          log.debug(`[TERMINAL PANEL] switchTerminal: real renderable NOT found for ${id}, falling back to proxy`);
          try { entry.contentBox.visible = shouldShow; } catch (err) {
            log.debug(`[TERMINAL PANEL] switchTerminal: error setting visible for ${id}: ${err}`);
          }
        }
      }

      activeTabId = tabId;
      showOnly(r.connected);

      // Resolve children for the active terminal
      const entry = terminals.get(tabId);
      if (entry) {
        log.debug(`[TERMINAL PANEL] switchTerminal: found entry for ${tabId}, resolving children`);
        // Find the content box by its unique id
        const contentBox = renderer.root.findDescendantById(`tab-content-${tabId}`);
        if (contentBox) {
          const nodeChildren = contentBox.getChildren();
          entry.resolvedChildren = nodeChildren ?? [];
          log.debug(`[TERMINAL PANEL] switchTerminal: resolved ${entry.resolvedChildren.length} children`);
          entry.renderer.resolveChildren(entry.resolvedChildren);
        } else {
          log.debug(`[TERMINAL PANEL] switchTerminal: contentBox not found by id 'tab-content-${tabId}'`);
        }
      } else {
        log.debug(`[TERMINAL PANEL] switchTerminal: no entry found for ${tabId}`);
      }

      renderer.requestRender();
    },

    getActiveTabId: () => activeTabId,

    updateTerminalContentForTab(tabId: string): boolean {
      const entry = terminals.get(tabId);
      if (!entry) return false;
      const ok = entry.renderer.updateContent();
      if (ok) renderer.requestRender();
      return ok;
    },

    setTerminalRenderer(r: TerminalRenderer): void {
      terminalRenderer = r;
    },

    setTerminalContent(node: ReturnType<typeof Box>): void {
      const r = resolve();
      if (!r) {
        log.debug(`[TERMINAL PANEL] setTerminalContent: resolve() returned null`);
        return;
      }
      log.debug(`[TERMINAL PANEL] setTerminalContent: hasTerminalContent=${hasTerminalContent}`);
      
      // If there's still old content (shouldn't happen after unregisterTerminal), remove it
      if (hasTerminalContent) {
        const children = r.connected.getChildren() ?? [];
        log.debug(`[TERMINAL PANEL] setTerminalContent: clearing ${children.length} old children`);
        for (let i = children.length - 1; i >= 0; i--) {
          try { r.connected.remove(children[i]?.id ?? ''); } catch {}
        }
      }
      
      log.debug(`[TERMINAL PANEL] setTerminalContent: adding new node`);
      r.connected.add(node);
      lastAddedContentBox = node;
      hasTerminalContent = true;
      
      // Resolve children for in-place updates
      if (terminalRenderer) {
        const nodeChildren = node.getChildren?.() ?? [];
        terminalRenderer.resolveChildren(nodeChildren);
        log.debug(`[TERMINAL PANEL] setTerminalContent: resolved ${nodeChildren.length} children`);
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

    setFocused(value: boolean): void {
      const r = resolve();
      if (r) r.container.borderColor = value ? '#7aa2f7' : '#3b4261';
    },
  };
}
