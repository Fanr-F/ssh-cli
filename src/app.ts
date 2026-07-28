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
import { SftpClient } from './sftp/sftp-client';
import { createInputDialog } from './sftp/sftp-input-dialog';
import { createSftpTab, type SftpTabAPI } from './sftp/sftp-tab';
import { copyToClipboard, pasteFromClipboard } from './clipboard';
import { logDebug, logIO } from './logger';

type FocusZone = 'sidebar' | 'terminal' | 'form' | 'sftp';

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
    sftpClient?: SftpClient;
    sftpTab?: SftpTabAPI;
  }>();

  constructor(renderer: CliRenderer) {
    this.renderer = renderer;
  }

  async init(): Promise<void> {
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
      onHelp: () => this.helpPopup.toggle(),
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
          tab.renderer.clearSelection();
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
        this.sidebar, divider,         Box(
          { id: 'right-panel', flexDirection: 'column', flexGrow: 1 },
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
      const seqHex = [...(key.sequence ?? '')].map(c => `0x${c.charCodeAt(0).toString(16).padStart(2,'0')}`).join(' ');
      logDebug(`[KEY] name=${key.name} ctrl=${key.ctrl} shift=${key.shift} alt=${key.alt} seqHex=[${seqHex}] raw=${JSON.stringify(key.sequence)}`);

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

      // Global: Alt+Up/Down → navigate sidebar connections
      // OpenTUI doesn't set key.alt, detect via xterm escape sequence: ESC[1;3A (Alt+Up) / ESC[1;3B (Alt+Down)
      const seq = key.sequence ?? '';
      logDebug(`[KEY ALT] seq.length=${seq.length} seq[0]=0x${(seq.charCodeAt(0)||0).toString(16)} seq === altLeft? ${seq === '\x1b[1;3D'} seq === altRight? ${seq === '\x1b[1;3C'}`);
      if (seq === '\x1b[1;3A') { this.sidebar.selectPrevious(); key.preventDefault(); return; }
      if (seq === '\x1b[1;3B') { this.sidebar.selectNext(); key.preventDefault(); return; }

      // Global: Alt+Left/Right → switch focus between sidebar and terminal
      if (seq === '\x1b[1;3D') { logDebug(`[KEY] Alt+Left matched, switching to sidebar`); this.focusSidebar(); key.preventDefault(); return; }
      if (seq === '\x1b[1;3C') { logDebug(`[KEY] Alt+Right matched, switching to terminal`); this.focusTerminal(); key.preventDefault(); return; }

      // Global: F1 → toggle help popup
      if (key.name === 'f1') {
        this.helpPopup.toggle();
        key.preventDefault(); return;
      }

      // Global: F2-F12 → switch to tab 1-11
      if (key.name.startsWith('f') && !key.ctrl && !key.shift) {
        const num = parseInt(key.name.slice(1), 10);
        if (num >= 2 && num <= 12) {
          logDebug(`[KEY] F${num} intercepted globally, focus=${this.focus}`);
          this.switchToTabIndex(num - 2);
          key.preventDefault(); return;
        }
      }

      // Global: Ctrl+U → upload file
      if (key.ctrl && key.name === 'u' && this.focus === 'terminal') {
        logDebug(`[KEY] Ctrl+U upload, focus=${this.focus}`);
        key.preventDefault();
        this.openUploadDialog();
        return;
      }

      // Global: Ctrl+D → download file
      if (key.ctrl && key.name === 'd' && this.focus === 'terminal') {
        logDebug(`[KEY] Ctrl+D download, focus=${this.focus}`);
        key.preventDefault();
        this.openDownloadDialog();
        return;
      }

      // Global: Ctrl+E → open SFTP tab
      if (key.ctrl && key.name === 'e') {
        key.preventDefault();
        this.openSftpTab();
        return;
      }

      // Terminal: PageUp/PageDown → scroll viewport
      if (this.focus === 'terminal') {
        if (key.name === 'pageup') {
          const activeId = this.tabBar.getActiveTabId();
          if (activeId) {
            const tab = this.tabs.get(activeId);
            if (tab?.vterm) {
              tab.vterm.scrollViewport(tab.vterm.rows - 1);
              this.terminalPanel.updateTerminalContentForTab(activeId);
              this.renderer.requestRender();
            }
          }
          key.preventDefault(); return;
        }
        if (key.name === 'pagedown') {
          const activeId = this.tabBar.getActiveTabId();
          if (activeId) {
            const tab = this.tabs.get(activeId);
            if (tab?.vterm) {
              tab.vterm.scrollViewport(-tab.vterm.rows + 1);
              this.terminalPanel.updateTerminalContentForTab(activeId);
              this.renderer.requestRender();
            }
          }
          key.preventDefault(); return;
        }
      }

      // Help popup: Up/Down scroll, other keys close it
      if (this.helpPopup.isVisible()) {
        if (key.name === 'up' || key.name === 'pageup') {
          this.helpPopup.scrollUp();
          key.preventDefault(); return;
        }
        if (key.name === 'down' || key.name === 'pagedown') {
          this.helpPopup.scrollDown();
          key.preventDefault(); return;
        }
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
      if (this.focus === 'sftp') {
        logDebug(`[KEY] SFTP focus, forwarding key=${key.name} ctrl=${key.ctrl} to sftpTab`);
        const activeId = this.tabBar.getActiveTabId();
        if (activeId) {
          const tab = this.tabs.get(activeId);
          if (tab?.sftpTab) {
            tab.sftpTab.handleKey(key);
            key.preventDefault();
          }
        }
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
    this.renderer.on('resize', () => {
      logDebug(`[RESIZE] renderer.resize event fired`);
      this.handleResize();
    });
  }

  private handleResize(): void {
    if (this.resizeTimer) clearTimeout(this.resizeTimer);
    this.resizeTimer = setTimeout(() => {
      const width = Math.max(20, this.renderer.width ?? 80);
      const height = Math.max(5, this.renderer.height ?? 24);
      const sidebarW = this.sidebar?.getWidth() ?? 30;
      const cols = Math.max(40, width - sidebarW - 1 - 2); // -1 divider, -2 borders
      const rows = Math.max(10, height - 4); // -2 borders, -1 toolbar, -1 tabBar

      logDebug(`[RESIZE] handleResize: renderer=${width}x${height}, sidebarW=${sidebarW}, cols=${cols}, rows=${rows}`);

      // Capture active tab's old rows BEFORE any resize
      const activeId = this.tabBar.getActiveTabId();
      const activeTab = activeId ? this.tabs.get(activeId) : undefined;
      const oldActiveRows = activeTab?.vterm?.rows ?? 0;
      logDebug(`[RESIZE] active tab oldRows=${oldActiveRows}, newRows=${rows}`);

      // Resize all active tabs
      for (const [tabId, tab] of this.tabs) {
        if (tab.vterm) tab.vterm.resize(cols, rows);
        if (tab.ssh?.isConnected()) tab.ssh.resizePty(cols, rows);
      }

      // Rebuild content box if row count changed, otherwise just update content
      if (activeId) {
        if (oldActiveRows !== rows) {
          logDebug(`[RESIZE] rows changed ${oldActiveRows} -> ${rows}, rebuilding content box`);
          this.terminalPanel.resizeTerminal(activeId, rows);
          // Immediately populate the new content box with reflowed grid content
          const ok = this.terminalPanel.updateTerminalContentForTab(activeId);
          logDebug(`[RESIZE] post-resize updateContent result: ${ok}`);
        } else {
          logDebug(`[RESIZE] rows unchanged, updating content only`);
          this.terminalPanel.updateTerminalContentForTab(activeId);
        }
      }
      this.renderer.requestRender();

      // Post-resize verification: dump grid content after 200ms (after all updates settle)
      if (activeId && activeTab) {
        setTimeout(() => {
          const lines = activeTab.vterm.getStyledLines();
          const rows = activeTab.vterm.rows;
          logDebug(`[RESIZE] VERIFY: ${lines.length} styled lines, vterm.rows=${rows}`);
          for (let i = 0; i < Math.min(rows, 5); i++) {
            const rawChunks = (lines[i] as any).chunks ?? [];
            const txt = rawChunks.map((c: any) => c.text ?? '').join('');
            logDebug(`[RESIZE] VERIFY row=${i}: "${txt.substring(0, 60)}"`);
          }
        }, 200);
      }
    }, 100);
  }

  private focusSidebar(): void {
    this.focus = 'sidebar'; this.sidebar.setFocusable(true);
    this.sidebar.setFocused(true);
    if (this.terminalPanel) { this.terminalPanel.setFocusable(false); this.terminalPanel.setFocused(false); }
    this.statusBar.setStatus('Sidebar focused'); this.renderer.requestRender();
  }

  private focusTerminal(): void {
    this.focus = 'terminal'; this.sidebar.setFocusable(false);
    this.sidebar.setFocused(false);
    if (this.terminalPanel) { this.terminalPanel.setFocusable(true); this.terminalPanel.setFocused(true); this.terminalPanel.focus(); }
    this.statusBar.setStatus('Terminal focused'); this.renderer.requestRender();
  }

  private focusForm(): void {
    this.focus = 'form'; this.sidebar.setFocusable(false);
    if (this.terminalPanel) this.terminalPanel.setFocusable(false);
  }

  private focusSftp(): void {
    this.focus = 'sftp';
    this.sidebar.setFocusable(false);
    this.sidebar.setFocused(false);
    if (this.terminalPanel) { this.terminalPanel.setFocusable(false); this.terminalPanel.setFocused(false); }
    this.statusBar.setStatus('SFTP focused');
    this.renderer.requestRender();
  }

  private async connectTo(config: ConnectionConfig): Promise<void> {
    logDebug(`[CONNECT] host=${config.host}, username=${config.username}, current tabs=${this.tabs.size}`);
    
    // Close any tabs that failed to connect (in error state)
    for (const [tabId, tab] of this.tabs) {
      if (!tab.ssh.isConnected() && tab.ssh.getLastError()) {
        logDebug(`[CONNECT] closing failed tab ${tabId}`);
        this.closeTab(tabId);
      }
    }
    
    this.terminalPanel.showConnecting(config.host);
    this.statusBar.setStatus('Connecting to ' + config.host + '...');
    this.renderer.requestRender();
    const cols = Math.max(40, this.renderer.width - 32);
    const rows = Math.max(10, this.renderer.height - 4); // -2 borders, -1 toolbar, -1 tabBar
    logDebug(`[CONNECT] initial terminal size: renderer=${this.renderer.width}x${this.renderer.height}, cols=${cols}, rows=${rows}`);

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
    this.tabBar.addTab(tabId, tabTitle, 'terminal');

    // Track whether the SSH session was ever established
    let wasConnected = false;

    ssh.on('ready', async () => {
      wasConnected = true;
      // Update tab title with connected status
      this.tabBar.updateTabTitle(tabId, `SSH: ${config.username}@${config.host}`);

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

    const tabType = this.tabBar.getTabType(id);
    logDebug(`[APP] switchToTab: type=${tabType}, calling tabBar.switchTo(${id})`);

    this.tabBar.switchTo(id);

    if (tabType === 'sftp' && tab.sftpTab) {
      // SFTP tab: hide terminal panel, show SFTP
      this.terminalPanel.setVisible(false);
      const rightPanel = this.renderer.root.findDescendantById('right-panel');
      if (rightPanel && !rightPanel.findDescendantById('sftp-tab')) {
        rightPanel.add(tab.sftpTab.component);
      }
      // Set SFTP visible via real renderable
      const sftpReal = this.renderer.root.findDescendantById('sftp-tab');
      if (sftpReal) sftpReal.visible = true;
      this.focusSftp();
    } else {
      // Terminal tab: hide SFTP, show terminal panel
      const sftpReal = this.renderer.root.findDescendantById('sftp-tab');
      if (sftpReal) sftpReal.visible = false;
      this.terminalPanel.setVisible(true);
      this.terminalPanel.switchTerminal(id);
      this.focusTerminal();
    }

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

    logDebug(`[CLOSE TAB] id=${id}, isSftp=${!!tab.sftpTab}, ssh=${tab.ssh.isConnected()}`);

    const wasActive = this.tabBar.getActiveTabId() === id;

    // SFTP component cleanup
    if (tab.sftpTab) {
      tab.sftpTab.destroy();
      const rightPanel = this.renderer.root.findDescendantById('right-panel');
      if (rightPanel) {
        const sftpInPanel = rightPanel.findDescendantById('sftp-tab');
        if (sftpInPanel) rightPanel.remove('sftp-tab');
      }
    }

    // Disconnect own SSH connection
    if (tab.ssh.isConnected()) {
      await tab.ssh.disconnect();
      logDebug(`[CLOSE TAB] SSH disconnected for ${id}`);
    }

    // Unregister terminal (only terminal tabs register in terminal panel)
    if (!tab.sftpTab) {
      this.terminalPanel.unregisterTerminal(id);
    }

    this.tabBar.removeTab(id);
    this.tabs.delete(id);
    logDebug(`[CLOSE TAB] removed ${id}, tabs remaining=${this.tabs.size}`);

    if (this.tabs.size > 0 && wasActive) {
      const remainingIds = this.tabBar.getTabIds();
      if (remainingIds.length > 0) this.switchToTab(remainingIds[0]);
    } else if (this.tabs.size === 0) {
      this.terminalPanel.showIdle();
    }

    this.renderer.requestRender();
  }

  private async openForm(existing: ConnectionConfig | null): Promise<void> {
    if (this.form) return;
    this.focusForm();
    const form = createConnectionForm(this.renderer, existing ?? undefined);
    form.onCancel(() => { this.closeForm(form); this.focusSidebar(); });
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

    logDebug(`[COPY] handleCopy called, focus=${this.focus}`);

    if (this.focus === 'sidebar') {
      // Copy selected connection info
      const conn = this.sidebar.getSelectedConnection();
      if (conn) {
        text = `${conn.username}@${conn.host}:${conn.port}`;
        logDebug(`[COPY] sidebar: copied connection info="${text}"`);
      }
    } else if (this.focus === 'terminal') {
      // Check our custom TerminalRenderer selection first, then OpenTUI's, then fallback
      const activeId = this.tabBar.getActiveTabId();
      if (activeId) {
        const entry = this.tabs.get(activeId);
        if (entry?.renderer) {
          // 1. Our custom selection on TerminalRenderer (monkey-patched Generic)
          if (entry.renderer.hasSelection()) {
            text = entry.renderer.getSelectedText();
            logDebug(`[COPY] terminal: copied custom selection="${text.substring(0, 100)}"`);
            entry.renderer.clearSelection();
          }
          // 2. OpenTUI's built-in selection (in case it somehow works)
          else if (this.renderer.hasSelection) {
            const selection = this.renderer.getSelection();
            text = selection?.getSelectedText() ?? '';
            logDebug(`[COPY] terminal: copied OpenTUI selection="${text.substring(0, 100)}"`);
            this.renderer.clearSelection();
          }
        }
      }

      // 3. No selection — copy the last non-empty visible line
      if (!text) {
        logDebug(`[COPY] terminal: no selection, using getVisibleLines fallback`);
        if (activeId) {
          const entry = this.tabs.get(activeId);
          if (entry?.renderer) {
            const lines = entry.renderer.getVisibleLines();
            for (let i = lines.length - 1; i >= 0; i--) {
              const line = lines[i].trim();
              if (line.length > 0) {
                text = line;
                logDebug(`[COPY] terminal: fallback copied line ${i}="${text.substring(0, 100)}"`);
                break;
              }
            }
          }
        }
      }

      // 4. Still no text — send SIGINT
      if (!text) {
        if (activeId) {
          const tab = this.tabs.get(activeId);
          if (tab?.ssh.isConnected()) {
            tab.ssh.writeToShell('\x03');
            this.statusBar.setStatus('Sent interrupt (Ctrl+C)');
          }
        }
        this.renderer.requestRender();
        return;
      }
    } else if (this.focus === 'form' && this.form) {
      // Copy the content of the currently focused form field
      text = this.form.getFocusedFieldContent();
      logDebug(`[COPY] form: copied field content="${text?.substring(0, 50)}"`);
    }

    if (text) {
      logDebug(`[COPY] copying to clipboard: "${text.substring(0, 100)}"`);
      const ok = await copyToClipboard(text);
      logDebug(`[COPY] copyToClipboard result: ok=${ok}`);
      this.statusBar.setStatus(ok ? 'Copied to clipboard' : 'Copy failed');
    } else {
      logDebug(`[COPY] no text to copy`);
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

  // ── SFTP handlers ─────────────────────────────────────────────

  private openUploadDialog(): void {
    const activeId = this.tabBar.getActiveTabId();
    if (!activeId) {
      this.statusBar.setStatus('No active connection');
      this.renderer.requestRender();
      return;
    }
    const tab = this.tabs.get(activeId);
    if (!tab?.ssh.isConnected()) {
      this.statusBar.setStatus('Not connected');
      this.renderer.requestRender();
      return;
    }

    const dialog = createInputDialog(
      this.renderer,
      'Upload File',
      'Local path:',
      '/path/to/local/file',
      async (localPath: string) => {
        this.statusBar.setStatus(`Uploading ${localPath}...`);
        this.renderer.requestRender();
        try {
          const sftp = await tab.ssh.startSftp();
          const client = new SftpClient(sftp);
          const remotePath = localPath.split(/[/\\]/).pop() || 'file';
          await client.upload(localPath, remotePath);
          this.statusBar.setStatus(`Uploaded: ${remotePath}`);
          client.close();
        } catch (err) {
          const msg = err instanceof Error ? err.message : 'Upload failed';
          this.statusBar.setStatus(`Upload failed: ${msg}`);
        }
        this.renderer.requestRender();
      },
      () => {},
    );
    this.form = dialog;
    this.focusForm();
    dialog.focus();
    this.renderer.requestRender();
  }

  private openDownloadDialog(): void {
    const activeId = this.tabBar.getActiveTabId();
    if (!activeId) {
      this.statusBar.setStatus('No active connection');
      this.renderer.requestRender();
      return;
    }
    const tab = this.tabs.get(activeId);
    if (!tab?.ssh.isConnected()) {
      this.statusBar.setStatus('Not connected');
      this.renderer.requestRender();
      return;
    }

    const dialog = createInputDialog(
      this.renderer,
      'Download File',
      'Remote path:',
      '/path/to/remote/file',
      async (remotePath: string) => {
        this.statusBar.setStatus(`Downloading ${remotePath}...`);
        this.renderer.requestRender();
        try {
          const sftp = await tab.ssh.startSftp();
          const client = new SftpClient(sftp);
          const localPath = remotePath.split('/').pop() || 'file';
          await client.download(remotePath, localPath);
          this.statusBar.setStatus(`Downloaded: ${localPath}`);
          client.close();
        } catch (err) {
          const msg = err instanceof Error ? err.message : 'Download failed';
          this.statusBar.setStatus(`Download failed: ${msg}`);
        }
        this.renderer.requestRender();
      },
      () => {},
    );
    this.form = dialog;
    this.focusForm();
    dialog.focus();
    this.renderer.requestRender();
  }

  private async openSftpTab(): Promise<void> {
    const activeId = this.tabBar.getActiveTabId();
    if (!activeId) {
      this.statusBar.setStatus('No active connection');
      this.renderer.requestRender();
      return;
    }
    const tab = this.tabs.get(activeId);
    if (!tab?.ssh.isConnected()) {
      this.statusBar.setStatus('Not connected');
      this.renderer.requestRender();
      return;
    }

    try {
      const config = tab.config;
      const sftpSsh = new SshConnection();
      await sftpSsh.connect(config);
      const sftp = await sftpSsh.startSftp();
      const sftpClient = new SftpClient(sftp);

      const remotePwd = '~';
      const localPwd = process.env.HOME || process.env.USERPROFILE || '/';

      const tabId = `sftp-${Date.now()}`;
      const tabTitle = `SFTP: ${config.username}@${config.host}`;

      const sftpTabComponent = createSftpTab(this.renderer, sftpClient, remotePwd, localPwd);

      this.tabs.set(tabId, {
        vterm: tab.vterm,
        renderer: tab.renderer,
        ssh: sftpSsh,
        config,
        sftpClient,
        sftpTab: sftpTabComponent,
      });

      this.tabBar.addTab(tabId, tabTitle, 'sftp');
      this.switchToTab(tabId);
      this.statusBar.setStatus('SFTP connected');
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to open SFTP';
      this.statusBar.setStatus(`SFTP error: ${msg}`);
    }
    this.renderer.requestRender();
  }
}
