import { Box } from '@opentui/core';
import type { CliRenderer, KeyEvent, PasteEvent } from '@opentui/core';
import type { ConnectionConfig } from './types/connection';
import { ConnectionStore } from './storage/connections';
import { createSidebar, type SidebarAPI } from './ui/sidebar';
import { createConnectionForm } from './ui/connection-form';
import { createTerminalPanel, type TerminalPanelAPI } from './ui/terminal-panel';
import { createStatusBar, type StatusBarAPI } from './ui/status-bar';
import { createToolbar } from './ui/toolbar';
import { ScreenBuffer } from './terminal/screen-buffer';
import { AnsiProcessor } from './terminal/ansi-processor';
import { TerminalRenderer } from './terminal/terminal-renderer';
import { SshConnection } from './ssh/connection';
import { copyToClipboard, pasteFromClipboard } from './clipboard';

type FocusZone = 'sidebar' | 'terminal' | 'form';

export class App {
  private renderer: CliRenderer;
  private store!: ConnectionStore;
  private mainContainer!: ReturnType<typeof Box>;
  private toolbar!: ReturnType<typeof Box>;
  private sidebar!: ReturnType<typeof Box> & SidebarAPI;
  private terminalPanel!: TerminalPanelAPI;
  private statusBar!: StatusBarAPI;
  private form: any = null;
  private screenBuffer: ScreenBuffer | null = null;
  private ansiProcessor: AnsiProcessor | null = null;
  private terminalRenderer: TerminalRenderer | null = null;
  private sshConnection: SshConnection | null = null;
  private focus: FocusZone = 'sidebar';
  private connections: ConnectionConfig[] = [];
  private resizeTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(renderer: CliRenderer) {
    this.renderer = renderer;
  }

  async init(): Promise<void> {
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
      if (this.sshConnection && this.sshConnection.isConnected()) { this.sshConnection.writeToShell(key); }
    });
    this.statusBar = createStatusBar(this.renderer);
    this.statusBar.setKeybindings(['Ctrl+Q: Quit', 'Ctrl+Tab: Focus', 'Enter: Connect', 'A: Add', 'E: Edit', 'Del: Delete']);

    // Main content: toolbar + sidebar + terminal stacked vertically
    this.mainContainer = Box(
      { flexDirection: 'column', width: '100%', height: '100%' },
      this.toolbar,
      Box(
        { flexDirection: 'row', width: '100%', height: '100%' },
        this.sidebar, this.terminalPanel.component,
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
          const fakeKey = {
            name: ch, ctrl: false, meta: false, shift: false,
            sequence: ch, raw: ch, option: false, super: false,
            hyper: false, capsLock: false, numLock: false,
            baseCode: 0, repeated: false, code: '',
            _defaultPrevented: false, _propagationStopped: false,
            get defaultPrevented() { return this._defaultPrevented; },
            get propagationStopped() { return this._propagationStopped; },
            preventDefault() { this._defaultPrevented = true; },
            stopPropagation() { this._propagationStopped = true; },
          } as unknown as KeyEvent;
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
        const cols = Math.max(40, width - 32);
        const rows = Math.max(10, height - 2);
        if (this.screenBuffer) this.screenBuffer.resize(rows, cols);
        if (this.sshConnection?.isConnected()) this.sshConnection.resizePty(cols, rows);
      }, 100);
    });
  }

  private focusSidebar(): void {
    this.focus = 'sidebar'; this.sidebar.focusable = true;
    if (this.terminalPanel) this.terminalPanel.component.focusable = false;
    this.statusBar.setStatus('Sidebar focused'); this.renderer.requestRender();
  }

  private focusTerminal(): void {
    this.focus = 'terminal'; this.sidebar.focusable = false;
    if (this.terminalPanel) { this.terminalPanel.component.focusable = true; this.terminalPanel.focus(); }
    this.statusBar.setStatus('Terminal focused'); this.renderer.requestRender();
  }

  private focusForm(): void {
    this.focus = 'form'; this.sidebar.focusable = false;
    if (this.terminalPanel) this.terminalPanel.component.focusable = false;
  }

  private async connectTo(config: ConnectionConfig): Promise<void> {
    if (this.sshConnection && this.sshConnection.isConnected()) await this.sshConnection.disconnect();
    this.terminalPanel.showConnecting(config.host);
    this.statusBar.setStatus('Connecting to ' + config.host + '...');
    this.renderer.requestRender();
    const cols = Math.max(40, this.renderer.width - 32);
    const rows = Math.max(10, this.renderer.height - 2);
    this.screenBuffer = new ScreenBuffer(rows, cols);
    this.ansiProcessor = new AnsiProcessor(this.screenBuffer);
    this.terminalRenderer = new TerminalRenderer();
    this.terminalRenderer.setBuffer(this.screenBuffer);
    this.terminalPanel.setTerminalRenderer(this.terminalRenderer);
    this.sshConnection = new SshConnection();
    this.sshConnection.on('ready', async () => {
      this.terminalPanel.showConnected(config.host);
      this.statusBar.setConnected(config.host);
      this.renderer.requestRender();
      try {
        const channel = await this.sshConnection!.startShell({ cols, rows, term: 'xterm-256color' });
        const onSshData = (data: Buffer) => {
          this.ansiProcessor!.process(data.toString('utf-8'));
          if (this.terminalRenderer) {
            const rendered = this.terminalRenderer.renderDirty();
            this.terminalPanel.setTerminalContent(rendered);
          }
          this.renderer.requestRender();
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
      this.terminalPanel.showError(err.message); this.statusBar.setStatus('Error: ' + err.message); this.renderer.requestRender();
    });
    this.sshConnection.on('close', () => {
      this.terminalPanel.showDisconnected(); this.statusBar.setDisconnected(); this.focus = 'sidebar'; this.renderer.requestRender();
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
      if (this.screenBuffer) {
        const lines = this.screenBuffer.getVisibleLines();
        for (let i = lines.length - 1; i >= 0; i--) {
          const line = lines[i].map(c => c.char).join('').trim();
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
        const fakeKey = {
          name: ch, ctrl: false, meta: false, shift: false,
          sequence: ch, raw: ch, option: false, super: false,
          hyper: false, capsLock: false, numLock: false,
          baseCode: 0, repeated: false, code: '',
          _defaultPrevented: false, _propagationStopped: false,
          get defaultPrevented() { return this._defaultPrevented; },
          get propagationStopped() { return this._propagationStopped; },
          preventDefault() { this._defaultPrevented = true; },
          stopPropagation() { this._propagationStopped = true; },
        } as unknown as KeyEvent;
        this.form.handleKey(fakeKey);
      }
      this.statusBar.setStatus('Pasted to form');
    } else {
      this.statusBar.setStatus('Nothing to paste to');
    }
    this.renderer.requestRender();
  }
}
