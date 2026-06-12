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
  private form: any = null;
  private vterm: VtermAdapter | null = null;
  private terminalRenderer: TerminalRenderer | null = null;
  private sshConnection: SshConnection | null = null;
  private focus: FocusZone = 'sidebar';
  private connections: ConnectionConfig[] = [];
  private resizeTimer: ReturnType<typeof setTimeout> | null = null;

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
    this.terminalPanel = createTerminalPanel(this.renderer);
    this.terminalPanel.onKeyInput((key: string) => {
      if (this.sshConnection && this.sshConnection.isConnected()) {
        logIO('OUT', key);
        this.sshConnection.writeToShell(key);
      }
    });
    this.terminalPanel.onScroll((_direction: 'up' | 'down') => {
      // vterm handles scrolling internally via scrollViewport
    });
    this.statusBar = createStatusBar(this.renderer);
    this.statusBar.setKeybindings(['Ctrl+Q: Quit', 'Ctrl+Tab: Focus', 'Enter: Connect', 'A: Add', 'E: Edit', 'Del: Delete']);

    // Draggable divider between sidebar and terminal
    const divider = createDivider(
      this.renderer,
      (newWidth) => { this.sidebar.setWidth(newWidth); },
      () => { return this.sidebar.getWidth(); },
    );

    // Main content: toolbar + sidebar + divider + terminal stacked vertically
    this.mainContainer = Box(
      { flexDirection: 'column', width: '100%', height: '100%' },
      this.toolbar,
      Box(
        { flexDirection: 'row', width: '100%', height: '100%' },
        this.sidebar, divider, this.terminalPanel.component,
      ),
    );
    this.renderer.root.add(this.mainContainer);
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
    // Windows Terminal intercepts Ctrl+V for its own paste, so we listen for
    // the paste event that OpenTUI emits when bracketed paste sequences arrive.
    this.renderer.keyInput.on('paste', async (event: PasteEvent) => {
      const text = Buffer.from(event.bytes).toString('utf-8');
      if (!text) return;

      if (this.focus === 'terminal' && this.sshConnection && this.sshConnection.isConnected()) {
        this.sshConnection.writeToShell(text);
        this.statusBar.setStatus('Pasted to terminal');
      } else if (this.focus === 'form' && this.form) {
        // Forward paste characters to form
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
        if (this.vterm) this.vterm.resize(cols, rows);
        if (this.sshConnection?.isConnected()) this.sshConnection.resizePty(cols, rows);
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
    if (this.sshConnection && this.sshConnection.isConnected()) await this.sshConnection.disconnect();
    this.terminalPanel.showConnecting(config.host);
    this.statusBar.setStatus('Connecting to ' + config.host + '...');
    this.renderer.requestRender();
    const cols = Math.max(40, this.renderer.width - 32);
    const rows = Math.max(10, this.renderer.height - 2);

    // Create vterm adapter (replaces ansi-processor + screen-buffer)
    this.vterm = new VtermAdapter(cols, rows, (response) => {
      if (this.sshConnection?.isConnected()) {
        this.sshConnection.writeToShell(response);
      }
    });
    this.terminalRenderer = new TerminalRenderer();
    this.terminalRenderer.setVterm(this.vterm);
    this.terminalPanel.setTerminalRenderer(this.terminalRenderer);
    // Create terminal content box ONCE and add it to the connected panel
    const contentBox = this.terminalRenderer.createContentBox(rows);
    this.terminalPanel.setTerminalContent(contentBox);
    this.sshConnection = new SshConnection();

    // Track whether the SSH session was ever established so the close handler
    // can distinguish a failed connection attempt from a dropped session.
    let wasConnected = false;

    this.sshConnection.on('ready', async () => {
      wasConnected = true;
      this.terminalPanel.showConnected(config.host);
      this.statusBar.setConnected(config.host);
      this.renderer.requestRender();
      try {
        const channel = await this.sshConnection!.startShell({ cols, rows, term: 'xterm-256color' });
        const onSshData = (data: Buffer) => {
          logIO('IN', data);
          logDebug(`[SSH DATA] vterm=${!!this.vterm} renderer=${!!this.terminalRenderer} connected=${this.sshConnection?.isConnected()}`);
          try {
            this.vterm!.feed(data);
            const ok = this.terminalPanel.updateTerminalContent();
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
        channel.on('close', () => { this.terminalPanel.showDisconnected(); this.statusBar.setDisconnected(); this.renderer.requestRender(); });
        this.focusTerminal();
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Unknown error';
        this.terminalPanel.showError('Shell error: ' + msg); this.statusBar.setStatus('Shell error'); this.renderer.requestRender();
      }
    });
    this.sshConnection.on('error', (err: Error) => {
      logDebug(`[SSH ERROR] ${err.message}`);
      this.terminalPanel.showError(err.message); this.statusBar.setStatus('Error: ' + err.message); this.renderer.requestRender();
    });
    this.sshConnection.on('close', () => {
      logDebug('[SSH CLOSE] Connection closed');
      // Only show the "disconnected" state when the connection was previously
      // established.  When the connection never succeeded, the error message
      // displayed by the error/catch handler should remain visible instead of
      // being overwritten by a generic "Connection closed".
      if (wasConnected) {
        this.terminalPanel.showDisconnected(); this.statusBar.setDisconnected(); this.focus = 'sidebar'; this.renderer.requestRender();
      }
    });
    try {
      await this.sshConnection.connect(config);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Connection failed';
      this.terminalPanel.showError(msg); this.statusBar.setStatus('Connection failed'); this.renderer.requestRender();
    }
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
    if (this.sshConnection) await this.sshConnection.disconnect();
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
      if (this.vterm) {
        const lines = this.terminalRenderer?.getVisibleLines() ?? [];
        for (let i = lines.length - 1; i >= 0; i--) {
          const line = lines[i].trim();
          if (line) { text = line; break; }
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
      if (this.sshConnection && this.sshConnection.isConnected()) {
        this.sshConnection.writeToShell(text);
        this.statusBar.setStatus('Pasted to terminal');
      } else {
        this.statusBar.setStatus('Not connected');
      }
    } else if (this.focus === 'form' && this.form) {
      // Insert each character into the form's active field
      // We need a proper KeyEvent object with preventDefault()
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
