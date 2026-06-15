import { Box, ScrollBox } from '@opentui/core';
import type { CliRenderer, KeyEvent, PasteEvent } from '@opentui/core';
import type { ConnectionConfig } from './types/connection';
import { ConnectionStore } from './storage/connections';
import { createSidebar, type SidebarAPI } from './ui/sidebar';
import { createConnectionForm } from './ui/connection-form';
import { createTerminalPanel, type TerminalPanelAPI } from './ui/terminal-panel';
import { createStatusBar, type StatusBarAPI } from './ui/status-bar';
import { createToolbar } from './ui/toolbar';
import { createDivider } from './ui/divider';
import { createTabBar, type TabBarAPI } from './ui/tab-bar';
import { createHelpPopup, type HelpPopupAPI } from './ui/help-popup';
import { VtermAdapter } from './terminal/vterm-adapter';
import { TerminalRenderer } from './terminal/terminal-renderer';
import { SshConnection } from './ssh/connection';
import { copyToClipboard, pasteFromClipboard } from './clipboard';
import { appendFileSync, writeFileSync } from 'fs';

const LOG_FILE = 'ssh-cli-debug.log';
const IO_LOG_FILE = 'ssh-cli-io.log';

function logDebug(msg: string) {
  try { appendFileSync(LOG_FILE, `[${new Date().toISOString()}] ${msg}\n`); } catch {}
}

function logIO(direction: 'IN' | 'OUT', data: string | Buffer) {
  try {
    const ts = new Date().toISOString();
    const preview = typeof data === 'string'
      ? data.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '').replace(/[^\x20-\x7E\n\r\t]/g, '·')
      : data.toString('utf-8').replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '').replace(/[^\x20-\x7E\n\r\t]/g, '·');
    appendFileSync(IO_LOG_FILE, `[${ts}] ${direction} (${typeof data === 'string' ? data.length : data.length}B): ${preview.substring(0, 500)}\n`);
  } catch {}
}

type FocusZone = 'sidebar' | 'terminal' | 'form';

/** Create a minimal KeyEvent-like object for injecting characters into forms. */
function createFakeKeyEvent(ch: string) {
  let defaultPrevented = false;
  let propagationStopped = false;
  return {
    name: ch,
    ctrl: false,
    meta: false,
    shift: false,
    sequence: ch,
    raw: ch,
    option: false,
    super: false,
    hyper: false,
    capsLock: false,
    numLock: false,
    baseCode: 0,
    repeated: false,
    code: '',
    eventType: 'press' as const,
    source: 'raw' as const,
    number: false,
    get defaultPrevented() { return defaultPrevented; },
    get propagationStopped() { return propagationStopped; },
    preventDefault() { defaultPrevented = true; },
    stopPropagation() { propagationStopped = true; },
  };
}

export class App {
  private renderer: CliRenderer;
  private store!: ConnectionStore;
  private mainContainer!: ReturnType<typeof Box>;
  private toolbar!: ReturnType<typeof Box>;
  private sidebar!: ReturnType<typeof ScrollBox> & SidebarAPI;
  private terminalPanel!: TerminalPanelAPI;
  private statusBar!: StatusBarAPI;
  private tabBar!: TabBarAPI;
  private helpPopup!: HelpPopupAPI;
  private form: any = null;
  private focus: FocusZone = 'sidebar';
  private connections: ConnectionConfig[] = [];
  private resizeTimer: ReturnType<typeof setTimeout> | null = null;

  // ── Multi-tab state ──────────────────────────────────────────────
  private tabs = new Map<string, {
    vterm: VtermAdapter;
    renderer: TerminalRenderer;
    ssh: SshConnection;
    config: ConnectionConfig;
  }>();

  constructor(renderer: CliRenderer) {
    this.renderer = renderer;
  }

  async init(): Promise<void> {
    writeFileSync(LOG_FILE, '');
    writeFileSync(IO_LOG_FILE, '');
    logDebug('App starting');
    this.store = new ConnectionStore();
    try {
      this.connections = await this.store.getAll();
    } catch {
      this.connections = [];
    }
    this.buildLayout();
    this.setupGlobalKeys();
    this.setupResizeHandler();
    this.renderer.start();
  }

  private buildLayout(): void {
    // Toolbar with clickable shortcuts
    this.toolbar = createToolbar(this.renderer, {
      onNew: () => this.openForm(null),
      onEdit: () => { const c = this.sidebar.getSelectedConnection(); if (c) this.openForm(c); },
      onConnect: () => { const c = this.sidebar.getSelectedConnection(); if (c) this.connectTo(c); },
      onDelete: () => { const c = this.sidebar.getSelectedConnection(); if (c) this.deleteConnection(c); },
      onQuit: () => this.shutdown(),
    });

    this.sidebar = createSidebar(this.renderer, this.connections);
    this.sidebar.onConnectionSelect((conn) => { this.statusBar.setStatus('Selected: ' + conn.name); });
    this.sidebar.onAction((action, conn) => {
      switch (action) {
        case 'connect': this.connectTo(conn); break;
        case 'edit': this.openForm(conn); break;
        case 'delete': this.deleteConnection(conn); break;
      }
    });

    // Tab bar for multi-terminal support
    this.tabBar = createTabBar(this.renderer);
    this.tabBar.onTabSwitch((id) => this.switchToTab(id));
    this.tabBar.onTabClose((id) => this.closeTab(id));

    // Help popup
    this.helpPopup = createHelpPopup(this.renderer);

    this.terminalPanel = createTerminalPanel(this.renderer);
    this.terminalPanel.onKeyInput((key: string) => {
      const activeId = this.tabBar.getActiveTabId();
      if (activeId) {
        const tab = this.tabs.get(activeId);
        if (tab?.ssh.isConnected()) {
          // Auto-scroll to bottom when user types
          if (!tab.vterm.isAtBottom()) {
            tab.vterm.scrollToBottom();
            this.terminalPanel.updateTerminalContentForTab(activeId);
            this.renderer.requestRender();
          }
          logIO('OUT', key);
          tab.ssh.writeToShell(key);
        }
      }
    });
    this.terminalPanel.onScroll((direction: 'up' | 'down') => {
      // Scroll the active tab's vterm viewport
      const activeId = this.tabBar.getActiveTabId();
      if (activeId) {
        const tab = this.tabs.get(activeId);
        if (tab?.vterm) {
          const beforeOffset = tab.vterm.getViewportOffset();
          const scrollback = tab.vterm.getScrollbackLength();
          logDebug(`[SCROLL] direction=${direction}, scrollback=${scrollback}, viewportOffset=${beforeOffset}`);
          
          // up = scroll up (older content) = positive delta
          // down = scroll down (newer content) = negative delta
          const delta = direction === 'up' ? 3 : -3;
          logDebug(`[SCROLL] applying delta=${delta} (reversed from direction=${direction})`);
          
          tab.vterm.scrollViewport(delta);
          const afterOffset = tab.vterm.getViewportOffset();
          logDebug(`[SCROLL] after: viewportOffset=${afterOffset}, changed=${beforeOffset !== afterOffset}`);
          
          this.terminalPanel.updateTerminalContentForTab(activeId);
          this.renderer.requestRender();
        }
      }
    });
    this.statusBar = createStatusBar(this.renderer);
    this.statusBar.setKeybindings(['Ctrl+Q: Quit', 'Ctrl+Tab: Focus', 'Enter: Connect', 'A: Add', 'E: Edit', 'Del: Delete']);

    // Draggable divider between sidebar and terminal
    const divider = createDivider(
      this.renderer,
      (newWidth) => { this.sidebar.setWidth(newWidth); },
      () => { return this.sidebar.getWidth(); },
    );

    // Main content: toolbar + sidebar + divider + (tab bar + terminal) stacked vertically
    this.mainContainer = Box(
      { flexDirection: 'column', width: '100%', height: '100%' },
      this.toolbar,
      Box(
        { flexDirection: 'row', width: '100%', height: '100%' },
        this.sidebar, divider, Box(
          { flexDirection: 'column', flexGrow: 1 },
          this.tabBar.component,
          this.terminalPanel.component,
        ),
      ),
    );
    this.renderer.root.add(this.mainContainer);
    this.renderer.root.add(this.helpPopup.component);
    this.focusSidebar();
  }

  private setupGlobalKeys(): void {
    this.renderer.keyInput.on('keypress', async (key: KeyEvent) => {
      // Global: Ctrl+Q → quit
      if (key.ctrl && key.name === 'q') { this.shutdown(); return; }

      // Global: Ctrl+C → copy
      if (key.ctrl && key.name === 'c') {
        key.preventDefault();
        await this.handleCopy();
        return;
      }

      // Global: Ctrl+V → paste
      if (key.ctrl && key.name === 'v') {
        key.preventDefault();
        await this.handlePaste();
        return;
      }

      // Global: Ctrl+Tab → toggle focus
      if (key.ctrl && key.name === 'tab') {
        if (this.focus === 'sidebar') this.focusTerminal();
        else if (this.focus === 'terminal') this.focusSidebar();
        key.preventDefault(); return;
      }

      // Global: Ctrl+Shift+C → close current tab
      if (key.ctrl && key.shift && key.name === 'c') {
        const activeId = this.tabBar.getActiveTabId();
        if (activeId) this.closeTab(activeId);
        key.preventDefault(); return;
      }

      // Global: Ctrl+Shift+Tab → cycle to next tab
      if (key.ctrl && key.shift && key.name === 'tab') {
        this.cycleNextTab();
        key.preventDefault(); return;
      }

      // Global: F1 → toggle help popup
      if (key.name === 'f1') {
        this.helpPopup.toggle();
        key.preventDefault(); return;
      }

      // Global: F2-F12 → switch to tab 1-11
      if (key.name.startsWith('f') && !key.ctrl && !key.shift) {
        const num = parseInt(key.name.slice(1), 10);
        if (num >= 2 && num <= 12) {
          this.switchToTabIndex(num - 2);
          key.preventDefault(); return;
        }
      }

      // Help popup: any key closes it
      if (this.helpPopup.isVisible()) {
        this.helpPopup.hide();
        key.preventDefault(); return;
      }

      if (this.focus === 'form') {
        if (this.form) { this.form.handleKey(key); key.preventDefault(); }
        return;
      }
      if (this.focus === 'sidebar') {
        if (key.name === 'up') { this.sidebar.selectPrevious(); key.preventDefault(); }
        else if (key.name === 'down') { this.sidebar.selectNext(); key.preventDefault(); }
        else if (key.name === 'return' || key.name === 'enter') { const c = this.sidebar.getSelectedConnection(); if (c) this.connectTo(c); key.preventDefault(); }
        else if (key.name === 'a' && !key.ctrl) { this.openForm(null); key.preventDefault(); }
        else if (key.name === 'e' && !key.ctrl) { const c = this.sidebar.getSelectedConnection(); if (c) this.openForm(c); key.preventDefault(); }
        else if (key.name === 'delete' || key.name === 'backspace') { const c = this.sidebar.getSelectedConnection(); if (c) this.deleteConnection(c); key.preventDefault(); }
      }
    });

    // Handle terminal-initiated paste (bracketed paste from Windows Terminal, etc.)
    this.renderer.keyInput.on('paste', async (event: PasteEvent) => {
      const text = Buffer.from(event.bytes).toString('utf-8');
      if (!text) return;

      if (this.focus === 'terminal') {
        const activeId = this.tabBar.getActiveTabId();
        if (activeId) {
          const tab = this.tabs.get(activeId);
          if (tab?.ssh.isConnected()) {
            tab.ssh.writeToShell(text);
            this.statusBar.setStatus('Pasted to terminal');
          }
        }
      } else if (this.focus === 'form' && this.form) {
        for (const ch of text) {
          const fakeKey = createFakeKeyEvent(ch);
          this.form.handleKey(fakeKey);
        }
        this.statusBar.setStatus('Pasted to form');
      } else {
        this.statusBar.setStatus('Nothing to paste to');
      }
      this.renderer.requestRender();
    });
  }

  private setupResizeHandler(): void {
    process.stdout.on('resize', () => {
      if (this.resizeTimer) clearTimeout(this.resizeTimer);
      this.resizeTimer = setTimeout(() => {
        const width = Math.max(20, this.renderer.width ?? 80);
        const height = Math.max(5, this.renderer.height ?? 24);
        const sidebarW = this.sidebar?.getWidth() ?? 30;
        const cols = Math.max(40, width - sidebarW - 1 - 2); // -1 divider, -2 borders
        const rows = Math.max(10, height - 2);

        // Resize all active tabs
        for (const [, tab] of this.tabs) {
          if (tab.vterm) tab.vterm.resize(cols, rows);
          if (tab.ssh?.isConnected()) tab.ssh.resizePty(cols, rows);
        }
      }, 100);
    });
  }

  private focusSidebar(): void {
    this.focus = 'sidebar'; this.sidebar.setFocusable(true);
    if (this.terminalPanel) this.terminalPanel.setFocusable(false);
    this.statusBar.setStatus('Sidebar focused'); this.renderer.requestRender();
  }

  private focusTerminal(): void {
    this.focus = 'terminal'; this.sidebar.setFocusable(false);
    if (this.terminalPanel) { this.terminalPanel.setFocusable(true); this.terminalPanel.focus(); }
    this.statusBar.setStatus('Terminal focused'); this.renderer.requestRender();
  }

  private focusForm(): void {
    this.focus = 'form'; this.sidebar.setFocusable(false);
    if (this.terminalPanel) this.terminalPanel.setFocusable(false);
  }

  private async connectTo(config: ConnectionConfig): Promise<void> {
    logDebug(`[CONNECT] host=${config.host}, username=${config.username}, current tabs=${this.tabs.size}`);
    
    this.terminalPanel.showConnecting(config.host);
    this.statusBar.setStatus('Connecting to ' + config.host + '...');
    this.renderer.requestRender();
    const cols = Math.max(40, this.renderer.width - 32);
    const rows = Math.max(10, this.renderer.height - 2);

    // Create tab ID
    const tabId = `tab-${Date.now()}`;
    const tabTitle = `${config.username}@${config.host}`;
    logDebug(`[CONNECT] creating tab id=${tabId}, title=${tabTitle}`);

    // Create vterm adapter and renderer for this tab
    const vterm = new VtermAdapter(cols, rows, (response) => {
      if (tab?.ssh.isConnected()) {
        tab.ssh.writeToShell(response);
      }
    });
    const terminalRenderer = new TerminalRenderer();
    terminalRenderer.setVterm(vterm);

    // Register with terminal panel
    logDebug(`[CONNECT] registering terminal ${tabId}`);
    const contentBox = this.terminalPanel.registerTerminal(tabId, terminalRenderer, rows);
    logDebug(`[CONNECT] terminal registered: ${tabId}`);

    // Create SSH connection
    const ssh = new SshConnection();
    const tab = { vterm, renderer: terminalRenderer, ssh, config };
    this.tabs.set(tabId, tab);
    logDebug(`[CONNECT] tabs map size now=${this.tabs.size}`);

    // Add tab to tab bar
    logDebug(`[CONNECT] adding tab ${tabId} to tab bar`);
    this.tabBar.addTab(tabId, tabTitle);

    // Track whether the SSH session was ever established
    let wasConnected = false;

    ssh.on('ready', async () => {
      wasConnected = true;
      // Update tab title with connected status
      this.tabBar.updateTabTitle(tabId, `${config.username}@${config.host}`);

      // Switch to this tab
      this.tabBar.switchTo(tabId);
      this.terminalPanel.switchTerminal(tabId);
      this.terminalPanel.showConnected(config.host);
      this.statusBar.setConnected(config.host);
      this.focusTerminal();
      this.renderer.requestRender();

      try {
        const channel = await ssh.startShell({ cols, rows, term: 'xterm-256color' });
        const onSshData = (data: Buffer) => {
          logIO('IN', data);
          const wasAtBottom = vterm.isAtBottom();
          logDebug(`[SSH DATA] tab=${tabId} vterm=${!!vterm} renderer=${!!terminalRenderer} connected=${ssh.isConnected()} dataLen=${data.length} wasAtBottom=${wasAtBottom} viewportOffset=${vterm.getViewportOffset()}`);
          try {
            vterm.feed(data);
            // Auto-scroll to bottom on new data only if already at bottom
            // (don't interrupt user's scroll position)
            if (wasAtBottom) {
              vterm.scrollToBottom();
            }
            const ok = this.terminalPanel.updateTerminalContentForTab(tabId);
            logDebug(`[SSH DATA] updateContent result: ${ok}`);
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            const stack = err instanceof Error ? err.stack : '';
            logDebug(`[SSH DATA ERROR] ${msg}\n${stack}`);
            this.terminalPanel.showError('Render error: ' + msg);
            this.statusBar.setStatus('Render error');
            this.renderer.requestRender();
          }
        };
        channel.on('data', onSshData);
        channel.stderr.on('data', onSshData);
        channel.on('close', () => {
          logDebug(`[SSH CLOSE] Tab ${tabId} channel closed`);
          this.terminalPanel.showDisconnected();
          this.statusBar.setDisconnected();
          this.renderer.requestRender();
          // Auto-close tab on disconnect
          if (wasConnected) {
            this.closeTab(tabId);
          }
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Unknown error';
        this.terminalPanel.showError('Shell error: ' + msg);
        this.statusBar.setStatus('Shell error');
        this.renderer.requestRender();
      }
    });

    ssh.on('error', (err: Error) => {
      logDebug(`[SSH ERROR] Tab ${tabId}: ${err.message}`);
      this.terminalPanel.showError(err.message);
      this.statusBar.setStatus('Error: ' + err.message);
      this.renderer.requestRender();
    });

    ssh.on('close', () => {
      logDebug(`[SSH CLOSE] Tab ${tabId} connection closed`);
      if (wasConnected) {
        this.closeTab(tabId);
      }
    });

    try {
      await ssh.connect(config);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Connection failed';
      this.terminalPanel.showError(msg);
      this.statusBar.setStatus('Connection failed');
      this.renderer.requestRender();
    }
  }

  private switchToTab(id: string): void {
    logDebug(`[APP] switchToTab: id=${id}`);
    const tab = this.tabs.get(id);
    if (!tab) {
      logDebug(`[APP] switchToTab: tab not found for ${id}`);
      return;
    }

    logDebug(`[APP] switchToTab: calling terminalPanel.switchTerminal(${id})`);
    this.terminalPanel.switchTerminal(id);
    this.focusTerminal();
    this.renderer.requestRender();
    logDebug(`[APP] switchToTab: done`);
  }

  private switchToTabIndex(index: number): void {
    const ids = this.tabBar.getTabIds();
    if (index < ids.length) {
      this.switchToTab(ids[index]);
    }
  }

  private cycleNextTab(): void {
    const ids = this.tabBar.getTabIds();
    if (ids.length === 0) return;

    const currentId = this.tabBar.getActiveTabId();
    const currentIndex = currentId ? ids.indexOf(currentId) : -1;
    const nextIndex = (currentIndex + 1) % ids.length;
    this.switchToTab(ids[nextIndex]);
  }

  private async closeTab(id: string): Promise<void> {
    const tab = this.tabs.get(id);
    if (!tab) {
      logDebug(`[CLOSE TAB] id=${id} not found in tabs map`);
      return;
    }

    logDebug(`[CLOSE TAB] id=${id}, ssh connected=${tab.ssh.isConnected()}`);

    // Remember if this was the active tab before removing
    const wasActive = this.tabBar.getActiveTabId() === id;

    // Disconnect SSH
    if (tab.ssh.isConnected()) {
      logDebug(`[CLOSE TAB] disconnecting SSH for ${id}`);
      await tab.ssh.disconnect();
      logDebug(`[CLOSE TAB] SSH disconnected for ${id}`);
    }

    // Remove from terminal panel
    logDebug(`[CLOSE TAB] unregistering terminal ${id}`);
    this.terminalPanel.unregisterTerminal(id);

    // Remove from tab bar
    logDebug(`[CLOSE TAB] removing tab ${id} from tab bar`);
    this.tabBar.removeTab(id);

    // Remove from tabs map
    this.tabs.delete(id);
    logDebug(`[CLOSE TAB] tabs map size now=${this.tabs.size}`);

    // If there are remaining tabs and we closed the active one, switch to another
    if (this.tabs.size > 0 && wasActive) {
      const remainingIds = this.tabBar.getTabIds();
      if (remainingIds.length > 0) {
        const switchToId = remainingIds[0];
        logDebug(`[CLOSE TAB] switching to remaining tab: ${switchToId}`);
        // Log current state before switching
        logDebug(`[CLOSE TAB] tabs map keys: ${[...this.tabs.keys()].join(', ')}`);
        logDebug(`[CLOSE TAB] tab bar ids: ${remainingIds.join(', ')}`);
        this.switchToTab(switchToId);
      }
    } else if (this.tabs.size === 0) {
      logDebug(`[CLOSE TAB] no tabs left, showing idle`);
      this.terminalPanel.showIdle();
    }

    this.renderer.requestRender();
  }

  private async openForm(existing: ConnectionConfig | null): Promise<void> {
    if (this.form) return;
    this.focusForm();
    const form = createConnectionForm(this.renderer, existing ?? undefined);
    form.onCancel(() => { this.closeForm(form); });
    form.onSubmit(async (data: ConnectionConfig) => {
      try {
        if (existing) {
          await this.store.update(existing.id, data);
        } else {
          await this.store.add(data);
        }
        this.connections = await this.store.getAll();
        this.sidebar.setConnections(this.connections);
        this.closeForm(form); this.focusSidebar();
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Save failed';
        this.terminalPanel.showError('Save failed: ' + msg); this.renderer.requestRender();
      }
    });
    form.onDelete(async (id: string) => {
      try {
        await this.store.remove(id);
        this.connections = await this.store.getAll();
        this.sidebar.setConnections(this.connections);
        this.closeForm(form); this.focusSidebar();
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Delete failed';
        this.terminalPanel.showError('Delete failed: ' + msg); this.renderer.requestRender();
      }
    });
    this.form = form;
    this.renderer.root.add(form);
    // Activate keyboard input for the form
    form.focus();
    this.renderer.requestRender();
  }

  private closeForm(form: any): void {
    if (this.form === form) this.form = null;
    try { form.destroy(); } catch (err) {
      // Ignore destroy errors — form may already be torn down
    }
    this.renderer.requestRender();
  }

  private async deleteConnection(conn: ConnectionConfig): Promise<void> {
    try {
      await this.store.remove(conn.id);
      this.connections = await this.store.getAll();
      this.sidebar.setConnections(this.connections);
      this.statusBar.setStatus('Deleted: ' + conn.name);
      this.renderer.requestRender();
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Delete failed';
      this.statusBar.setStatus('Delete failed: ' + msg); this.renderer.requestRender();
    }
  }

  private async shutdown(): Promise<void> {
    // Disconnect all tabs
    for (const [, tab] of this.tabs) {
      if (tab.ssh.isConnected()) await tab.ssh.disconnect();
    }
    this.tabs.clear();
    this.renderer.destroy();
    process.exit(0);
  }

  // ── Clipboard handlers ─────────────────────────────────────────

  private async handleCopy(): Promise<void> {
    let text = '';

    if (this.focus === 'sidebar') {
      // Copy selected connection info
      const conn = this.sidebar.getSelectedConnection();
      if (conn) {
        text = `${conn.username}@${conn.host}:${conn.port}`;
      }
    } else if (this.focus === 'terminal') {
      // Copy last line of terminal output
      const activeId = this.tabBar.getActiveTabId();
      if (activeId) {
        const tab = this.tabs.get(activeId);
        if (tab) {
          const lines = tab.renderer.getVisibleLines() ?? [];
          for (let i = lines.length - 1; i >= 0; i--) {
            const line = lines[i].trim();
            if (line) { text = line; break; }
          }
        }
      }
    } else if (this.focus === 'form' && this.form) {
      // Copy the content of the currently focused form field
      text = this.form.getFocusedFieldContent();
    }

    if (text) {
      const ok = await copyToClipboard(text);
      this.statusBar.setStatus(ok ? 'Copied to clipboard' : 'Copy failed');
    } else {
      this.statusBar.setStatus('Nothing to copy');
    }
    this.renderer.requestRender();
  }

  private async handlePaste(): Promise<void> {
    const text = await pasteFromClipboard();
    if (!text) {
      this.statusBar.setStatus('Clipboard is empty');
      this.renderer.requestRender();
      return;
    }

    if (this.focus === 'terminal') {
      // Paste to SSH shell
      const activeId = this.tabBar.getActiveTabId();
      if (activeId) {
        const tab = this.tabs.get(activeId);
        if (tab?.ssh.isConnected()) {
          tab.ssh.writeToShell(text);
          this.statusBar.setStatus('Pasted to terminal');
        } else {
          this.statusBar.setStatus('Not connected');
        }
      }
    } else if (this.focus === 'form' && this.form) {
      // Insert each character into the form's active field
      for (const ch of text) {
        const fakeKey = createFakeKeyEvent(ch);
        this.form.handleKey(fakeKey);
      }
      this.statusBar.setStatus('Pasted to form');
    } else {
      this.statusBar.setStatus('Nothing to paste to');
    }
    this.renderer.requestRender();
  }
}
