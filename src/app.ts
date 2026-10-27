import {
  Box,
  ScrollBox,
  EmbeddedTerminalRenderable,
  createClipboard,
  createHostClipboard,
  createRendererClipboardAdapter,
} from '@opentui/core';
import type { CliRenderer, ClipboardService, KeyEvent, PasteEvent } from '@opentui/core';
import type { ConnectionConfig } from './types/connection';
import { ConnectionStore } from './storage/connections';
import { createSidebar, type SidebarAPI } from './ui/sidebar';
import { createConnectionForm } from './ui/connection-form';
import { createTerminalPanel, type TerminalPanelAPI } from './ui/terminal-panel';
import { createStatusBar, type StatusBarAPI } from './ui/status-bar';
import { createToolbar, type ToolbarAPI } from './ui/toolbar';
import { createDivider } from './ui/divider';
import { createTabBar, type TabBarAPI } from './ui/tab-bar';
import { createHelpPopup, type HelpPopupAPI } from './ui/help-popup';
import { SshConnection } from './ssh/connection';
import { createAltScreenTracker, type AltScreenTracker } from './ssh/alt-screen';
import { SftpClient } from './sftp/sftp-client';
import { createSftpTab, type SftpTabAPI } from './sftp/sftp-tab';
import { logDebug, logIO } from './logger';
import {
  findBinding,
  normalizeKey,
  type FocusZone,
  type KeyContext,
  type NormalizedKey,
  type Scope,
} from './keymap';

/** 一个标签页持有的运行态（终端标签与 SFTP 标签共用同一份结构）。 */
interface TabState {
  term: EmbeddedTerminalRenderable;
  ssh: SshConnection;
  config: ConnectionConfig;
  /** 远端是否处于备用屏（全屏程序）。SFTP 标签不接收终端数据，直接复用终端标签的实例。 */
  altScreen: AltScreenTracker;
  sftpClient?: SftpClient;
  sftpTab?: SftpTabAPI;
}

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
  private clipboard: ClipboardService;
  private store!: ConnectionStore;
  private mainContainer!: ReturnType<typeof Box>;
  private toolbar!: ToolbarAPI;
  // Omit 让 SidebarAPI 的同名成员优先：OpenTUI 0.6 起 Renderable 新增了 getWidth(): Value，
  // 与 SidebarAPI.getWidth(): number 冲突，直接取交集会让 getWidth() 的返回值变成 VNode。
  private sidebar!: Omit<ReturnType<typeof ScrollBox>, keyof SidebarAPI> & SidebarAPI;
  private terminalPanel!: TerminalPanelAPI;
  private statusBar!: StatusBarAPI;
  private tabBar!: TabBarAPI;
  private helpPopup!: HelpPopupAPI;
  private form: any = null;
  private focus: FocusZone = 'sidebar';
  private connections: ConnectionConfig[] = [];

  // ── Multi-tab state ──────────────────────────────────────────────
  private tabs = new Map<string, TabState>();

  /**
   * Ghostty 终端把视口滚动封装在原生层，0.6.6 没有导出公开的滚动 API，
   * 这里直接调用 zig 绑定（`zig.d.ts` 有声明）：负数向上（更早），正数向下。
   * 同时用于 PageUp/PageDown 和"输入时回到底部"。
   */
  private scrollTerminal(term: EmbeddedTerminalRenderable, delta: number): void {
    const t = term as any;
    if (!t.handle) return;
    try {
      t.lib.contextEmbeddedTerminalScroll(t.handle.context, t.handle, delta);
      term.requestRender();
    } catch (err) {
      logDebug(`[SCROLL] contextEmbeddedTerminalScroll failed: ${err}`);
    }
  }

  /**
   * PageUp / PageDown：
   * - 远端处在备用屏（vim / less / htop / mc / tmux …）时转发给远端，让程序自己翻页；
   * - 否则滚本地 scrollback（提示符下回看历史）；
   * - Shift+PageUp/PageDown 始终滚本地，作为显式逃生口。
   * 判定依据来自 `src/ssh/alt-screen.ts` 对 `ESC[?1049h/l` 的跟踪，不是猜测。
   */
  private handlePageKey(raw: KeyEvent, key: NormalizedKey, direction: 1 | -1): void {
    const tab = this.getActiveTab();
    if (!tab) return;

    if (!key.shift && tab.altScreen.active) {
      this.forwardKeyToShell(tab, raw);
      // 全屏程序会整屏重绘，把视口贴底避免重绘时画面错位
      this.scrollTerminal(tab.term, 1_000_000);
      return;
    }

    this.scrollTerminal(tab.term, direction * (Math.floor(tab.term.height) - 1));
  }

  /** 把一个按键按终端自己的编码规则发给远端 shell。 */
  private forwardKeyToShell(tab: TabState, key: KeyEvent): void {
    if (!tab.ssh.isConnected()) return;
    try {
      const bytes = tab.term.encodeKey(key);
      if (bytes.length === 0) return;
      tab.ssh.writeToShell(Buffer.from(bytes).toString('utf8'));
    } catch (err) {
      logDebug(`[KEY] forwardKeyToShell failed: ${err}`);
    }
  }

  constructor(renderer: CliRenderer) {
    this.renderer = renderer;
    // 复制：OSC52（终端）+ 系统剪贴板都写；粘贴：只有系统剪贴板可读。
    this.clipboard = createClipboard({
      host: createHostClipboard(),
      terminal: createRendererClipboardAdapter(renderer),
    });
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
        // 单击即把焦点交给侧边栏（否则鼠标点完，按键仍然发往终端）
        case 'select': this.focusSidebar(); break;
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
      this.toolbar.component,
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
    this.renderer.keyInput.on('keypress', (key: KeyEvent) => {
      void this.dispatchKey(key);
    });

    // Handle terminal-initiated paste (bracketed paste from Windows Terminal, etc.)
    this.renderer.keyInput.on('paste', async (event: PasteEvent) => {
      const text = Buffer.from(event.bytes).toString('utf-8');
      if (!text) return;

      if (this.focus === 'terminal') {
        // 粘贴交给聚焦的终端自己处理（encodePaste 会按需包 bracketed paste 标记，
        // 再通过 onData 回写远端）。这里不能 preventDefault，否则组件的处理会被跳过。
        if (this.getActiveTab()?.ssh.isConnected()) {
          this.statusBar.setStatus('Pasted to terminal');
        }
      } else if (this.focus === 'form' && this.form) {
        // 阻止已聚焦的 InputRenderable 再处理一次同一个 paste 事件
        event.preventDefault();
        for (const ch of text) {
          const fakeKey = createFakeKeyEvent(ch);
          this.form.handleKey(fakeKey);
        }
        this.statusBar.setStatus('Pasted to form');
      } else if (this.focus === 'sftp') {
        const activeId = this.tabBar.getActiveTabId();
        if (activeId) {
          const tab = this.tabs.get(activeId);
          if (tab?.sftpTab) {
            tab.sftpTab.pasteText(text);
            this.statusBar.setStatus('Pasted to SFTP');
          }
        }
      } else {
        this.statusBar.setStatus('Nothing to paste to');
      }
      this.renderer.requestRender();
    });
  }

  // ── Key dispatch ────────────────────────────────────────────────

  /**
   * binding.id → 动作。
   * 绑定表（src/keymap/bindings.ts）只声明「哪个键、在哪一层生效」，
   * 具体做什么统一放在这里；组件自管的键（owner: 'component'）会转交给组件。
   */
  private actions: Record<
    string,
    (raw: KeyEvent, key: NormalizedKey, ctx: KeyContext) => void | Promise<void>
  > = {
    'app.quit': () => this.shutdown(),
    'help.toggle': () => this.helpPopup.toggle(),
    'help.close': () => this.helpPopup.hide(),
    'help.scrollUp': () => this.helpPopup.scrollUp(),
    'help.pageUp': () => this.helpPopup.scrollUp(10),
    'help.scrollDown': () => this.helpPopup.scrollDown(),
    'help.pageDown': () => this.helpPopup.scrollDown(10),

    // 暂无键盘绑定：关标签目前只能双击（tabBar.onTabClose 直接调用 closeTab）。
    // 替代键确定后，只需在 bindings.ts 里加一行指向这个 id。
    'tab.close': () => {
      const id = this.tabBar.getActiveTabId();
      if (id) return this.closeTab(id);
    },
    'tab.prev': () => this.cyclePrevTab(),
    'tab.next': () => this.cycleNextTab(),
    'tab.goto': (_raw, key) => {
      const num = parseInt(key.name.slice(1), 10);
      if (num >= 2 && num <= 12) this.switchToTabIndex(num - 2);
    },

    'sftp.open': () => this.openSftpTab(),

    'focus.sidebar': () => this.focusSidebar(),
    'focus.terminal': () => this.focusTerminal(),

    'sidebar.up': () => this.sidebar.selectPrevious(),
    'sidebar.down': () => this.sidebar.selectNext(),
    'sidebar.connect': () => {
      const conn = this.sidebar.getSelectedConnection();
      if (conn) return this.connectTo(conn);
    },
    'sidebar.add': () => this.openForm(null),
    'sidebar.edit': () => {
      const conn = this.sidebar.getSelectedConnection();
      if (conn) return this.openForm(conn);
    },
    'sidebar.delete': () => {
      const conn = this.sidebar.getSelectedConnection();
      if (conn) return this.deleteConnection(conn);
    },
    'sidebar.copy': () => this.handleCopy(),

    'terminal.copy': () => this.handleCopy(),
    'terminal.paste': () => this.handlePaste(),
    'terminal.pageUp': (raw, key) => this.handlePageKey(raw, key, -1),
    'terminal.pageDown': (raw, key) => this.handlePageKey(raw, key, 1),

    // 剪贴板服务在 App 侧（要访问 clipboard 后端），所以这两个 id 虽然
    // 声明在 form / sftp 层，动作仍然由 App 执行。
    'form.copy': () => this.handleCopy(),
    'form.paste': () => this.handlePaste(),
    'sftp.copy': () => this.handleCopy(),
    'sftp.paste': () => this.handlePaste(),
  };

  /** 当前 UI 状态快照，供绑定表的 `when` 与动作使用。 */
  private buildKeyContext(): KeyContext {
    const activeId = this.tabBar?.getActiveTabId() ?? null;
    const tab = activeId ? this.tabs.get(activeId) : undefined;
    return {
      focus: this.focus,
      helpOpen: this.helpPopup?.isVisible() ?? false,
      formOpen: !!this.form,
      sftpCmdMode: tab?.sftpTab?.isCommandMode() ?? false,
      formField: this.form ? this.form.getFocusedFieldIndex() : -1,
      activeTabType: activeId ? this.tabBar.getTabType(activeId) : null,
    };
  }

  /**
   * 分发顺序 = 优先级：
   *   system（Ctrl+Q / F1） → 模态（help / form）→ global → 当前焦点
   */
  private scopesFor(ctx: KeyContext): Scope[] {
    if (ctx.helpOpen) return ['system', 'help'];
    if (ctx.formOpen) return ['system', 'form'];
    return ['system', 'global', ctx.focus];
  }

  private async dispatchKey(raw: KeyEvent): Promise<void> {
    const key = normalizeKey(raw);
    const ctx = this.buildKeyContext();

    logDebug(
      `[KEY] name=${key.name} ctrl=${key.ctrl} shift=${key.shift} meta=${key.meta} focus=${ctx.focus}`,
    );

    for (const scope of this.scopesFor(ctx)) {
      const binding = findBinding(scope, key, ctx);

      if (!binding) {
        // 组件自管的 scope（表单输入、SFTP 命令行输入）需要拿到所有按键
        if (scope === 'form' || scope === 'sftp') {
          this.delegateKey(scope, raw);
          raw.preventDefault();
          return;
        }
        continue;
      }

      logDebug(`[KEY] matched ${binding.id} (${scope})`);

      if (binding.owner === 'component') {
        this.delegateKey(scope, raw);
        raw.preventDefault();
        return;
      }

      const action = this.actions[binding.id];
      if (!action) {
        logDebug(`[KEY] no action registered for ${binding.id}`);
        continue;
      }

      raw.preventDefault();
      await action(raw, key, ctx);
      return;
    }

    // 终端：未命中的键原样交给原生终端编码；输入前先把视口拉回底部。
    // 不 preventDefault，否则按键到不了远端。
    if (!ctx.helpOpen && !ctx.formOpen && ctx.focus === 'terminal') {
      const tab = this.getActiveTab();
      if (tab) this.scrollTerminal(tab.term, 1_000_000);
    }
  }

  /** 把按键交给组件处理（组件内部查同一张绑定表）。 */
  private delegateKey(scope: Scope, raw: KeyEvent): void {
    if (scope === 'form') {
      this.form?.handleKey(raw);
      return;
    }
    if (scope === 'sftp') {
      const activeId = this.tabBar.getActiveTabId();
      if (!activeId) return;
      this.tabs.get(activeId)?.sftpTab?.handleKey(raw);
    }
  }

  private setupResizeHandler(): void {
    // 终端 renderable 依赖 Yoga 布局拿到新行列数，并在 onResize 里通过
    // onTerminalResize → ssh.resizePty 同步远端 PTY，这里只需触发一次重排。
    this.renderer.on('resize', () => {
      logDebug(`[RESIZE] renderer.resize event fired`);
      this.renderer.requestRender();
    });
  }

  /** 当前激活的页签（终端页签与 SFTP 页签共用同一份 term） */
  private getActiveTab() {
    const id = this.tabBar.getActiveTabId();
    return id ? this.tabs.get(id) : undefined;
  }

  private focusSidebar(): void {
    this.focus = 'sidebar'; this.sidebar.setFocusable(true);
    this.sidebar.setFocused(true);
    if (this.terminalPanel) { this.terminalPanel.setFocused(false); }
    this.toolbar?.setFocus('sidebar');
    this.statusBar.setStatus('Sidebar focused'); this.renderer.requestRender();
  }

  private focusTerminal(): void {
    this.focus = 'terminal'; this.sidebar.setFocusable(false);
    this.sidebar.setFocused(false);
    if (this.terminalPanel) { this.terminalPanel.setFocused(true); this.terminalPanel.focus(); }
    this.toolbar?.setFocus('terminal');
    this.statusBar.setStatus('Terminal focused'); this.renderer.requestRender();
  }

  private focusForm(): void {
    this.focus = 'form'; this.sidebar.setFocusable(false);
    if (this.terminalPanel) this.terminalPanel.setFocused(false);
    this.toolbar?.setFocus('form');
  }

  private focusSftp(): void {
    this.focus = 'sftp';
    this.sidebar.setFocusable(false);
    this.sidebar.setFocused(false);
    if (this.terminalPanel) { this.terminalPanel.setFocused(false); }
    this.toolbar?.setFocus('sftp');
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

    // Create the SSH connection first — the terminal's onData/onTerminalResize
    // callbacks need to reference it.
    const ssh = new SshConnection();

    // Ghostty VT 终端（原生解析器）：键盘编码、粘贴、滚轮、选区、resize 全部内建
    const term = new EmbeddedTerminalRenderable(this.renderer as any, {
      id: `tab-terminal-${tabId}`,
      width: '100%',
      height: '100%',
      cols,
      rows,
      // 单位是字节；10000 太小，按 200k 留够回滚
      maxScrollback: 200_000,
      // 默认背景用面板底色（Tokyo Night），而不是原生默认黑
      transparentBackground: true,
      selectable: true,
    });
    // 键盘输入 + 终端响应（DSR/DA 等）都要回写远端
    term.onData = (data, _source) => {
      const text = Buffer.from(data).toString('utf8');
      if (!text) return;
      logIO('OUT', text);
      ssh.writeToShell(text);
    };
    // Yoga 布局尺寸变化 → 同步远端 PTY
    term.onTerminalResize = (c, r) => ssh.resizePty(c, r);

    // Register with terminal panel
    logDebug(`[CONNECT] registering terminal ${tabId}`);
    this.terminalPanel.registerTerminal(tabId, term);
    logDebug(`[CONNECT] terminal registered: ${tabId}`);

    const tab: TabState = { term, ssh, config, altScreen: createAltScreenTracker() };
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
        // 优先使用布局后的真实行列数，未完成布局时退回估算值
        const shellCols = Math.floor(term.width) || cols;
        const shellRows = Math.floor(term.height) || rows;
        const channel = await ssh.startShell({ cols: shellCols, rows: shellRows, term: 'xterm-256color' });
        // 布局可能晚于 shell 创建完成，这里再对齐一次
        const realCols = Math.floor(term.width);
        const realRows = Math.floor(term.height);
        if (realCols > 0 && realRows > 0 && (realCols !== shellCols || realRows !== shellRows)) {
          ssh.resizePty(realCols, realRows);
        }
        const onSshData = (data: Buffer) => {
          logIO('IN', data);
          // 跟踪备用屏切换，决定 PageUp/PageDown 是转发给远端还是滚本地历史
          tab.altScreen.feed(data);
          // 视口跟随由原生终端负责：在底部时自动跟进，上滚后保持不动
          term.write(data);
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
      if (rightPanel) {
        // Mount each SFTP tab's component once; only the active one is visible
        for (const [, t] of this.tabs) {
          if (!t.sftpTab) continue;
          const rootId = t.sftpTab.id;
          if (!rightPanel.findDescendantById(rootId)) {
            rightPanel.add(t.sftpTab.component);
          }
          const sftpReal = rightPanel.findDescendantById(rootId);
          if (sftpReal) sftpReal.visible = (rootId === tab.sftpTab.id);
        }
      }
      this.focusSftp();
      tab.sftpTab.refresh();
    } else {
      // Terminal tab: hide SFTP, show terminal panel
      const rightPanel = this.renderer.root.findDescendantById('right-panel');
      if (rightPanel) {
        for (const [, t] of this.tabs) {
          if (!t.sftpTab) continue;
          const sftpReal = rightPanel.findDescendantById(t.sftpTab.id);
          if (sftpReal) sftpReal.visible = false;
        }
      }
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

  private cyclePrevTab(): void {
    const ids = this.tabBar.getTabIds();
    if (ids.length === 0) return;

    const currentId = this.tabBar.getActiveTabId();
    const currentIndex = currentId ? ids.indexOf(currentId) : -1;
    // 没有激活标签或已在第一个时，回绕到最后一个
    const prevIndex = currentIndex <= 0 ? ids.length - 1 : currentIndex - 1;
    this.switchToTab(ids[prevIndex]);
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
      // OpenTUI 0.6：remove() 只接受 renderable 对象，传 id 会抛
      // "remove expects a renderable child object"，需先取回节点。
      const sftpRoot = rightPanel?.findDescendantById(tab.sftpTab.id);
      if (rightPanel && sftpRoot) rightPanel.remove(sftpRoot);
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
    try {
      await this.clipboard.dispose();
    } catch {
      // 剪贴板后端释放失败不应阻塞退出
    }
    this.renderer.destroy();
    // OpenTUI 0.6 起 destroy() 是异步恢复终端（退出备用屏、关闭鼠标模式等）。
    // 必须等 closed 落地再退出，否则可能残留鼠标模式 / 备用屏。
    try {
      await this.renderer.closed;
    } catch {
      // 输出流出错时 closed 会 reject；此处已在退出流程，忽略即可
    }
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
      // 终端选区 → 复制；没有选区则直接发 SIGINT（旧行为）
      const tab = this.getActiveTab();
      if (tab?.term?.hasSelection()) {
        text = tab.term.getSelectedText();
        logDebug(`[COPY] terminal: copied selection="${text.substring(0, 100)}"`);
        // 传 null 走组件的 clear 分支（公开 API，不用碰内部绑定）
        tab.term.onSelectionChanged(null as any);
      }

      // 没有选中内容 → 发送 SIGINT
      if (!text) {
        if (tab?.ssh.isConnected()) {
          tab.ssh.writeToShell('\x03');
          this.statusBar.setStatus('Sent interrupt (Ctrl+C)');
          logDebug(`[COPY] terminal: sent SIGINT`);
        }
        this.renderer.requestRender();
        return;
      }
    } else if (this.focus === 'form' && this.form) {
      // Copy the content of the currently focused form field
      text = this.form.getFocusedFieldContent();
      logDebug(`[COPY] form: copied field content="${text?.substring(0, 50)}"`);
    } else if (this.focus === 'sftp') {
      // Copy selected file path in SFTP
      const activeId = this.tabBar.getActiveTabId();
      if (activeId) {
        const tab = this.tabs.get(activeId);
        if (tab?.sftpTab) {
          const filePath = tab.sftpTab.getSelectedFilePath();
          if (filePath) {
            text = filePath;
            logDebug(`[COPY] sftp: copied file path="${text}"`);
          }
        }
      }
    }

    if (text) {
      logDebug(`[COPY] copying to clipboard: "${text.substring(0, 100)}"`);
      const result = await this.clipboard
        .writeText(text, {
          destination: 'all-available',
          selection: 'clipboard',
          // 终端能力尚未探测完时 capabilities 为 null，adapter 会把 remote 默认为 true
          // 并跳过本机剪贴板写入；这里显式允许，保证本机绑定永远生效。
          allowRemoteHost: true,
        })
        .catch((err) => {
          logDebug(`[COPY] writeText failed: ${err}`);
          return null;
        });
      if (result) {
        logDebug(
          `[COPY] writeText: host=${result.host.status}, terminal=${result.terminal.status}/${result.terminal.capability}`,
        );
      }
      const ok = !!result && (result.host.status === 'written' || result.terminal.status === 'attempted');
      this.statusBar.setStatus(ok ? 'Copied to clipboard' : 'Copy failed');
    } else {
      logDebug(`[COPY] no text to copy`);
      this.statusBar.setStatus('Nothing to copy');
    }
    this.renderer.requestRender();
  }

  private async handlePaste(): Promise<void> {
    const result = await this.clipboard
      .read({ preferredTypes: ['text/plain'], selection: 'clipboard' })
      .catch((err) => {
        logDebug(`[PASTE] clipboard read failed: ${err}`);
        return null;
      });

    if (!result) {
      this.statusBar.setStatus('Clipboard read failed');
      this.renderer.requestRender();
      return;
    }

    if (result.status !== 'read') {
      logDebug(`[PASTE] clipboard read status: ${result.status}`);
      this.statusBar.setStatus(
        result.status === 'empty'
          ? 'Clipboard is empty'
          : result.status === 'unsupported'
            ? 'Clipboard unsupported'
            : result.status === 'timed-out'
              ? 'Clipboard read timed out'
              : 'Clipboard read failed',
      );
      this.renderer.requestRender();
      return;
    }

    // 统一行尾并去掉尾部空行：CRLF 直接灌进远程 shell 时，bracketed paste 会把 \r 当字面字符；
    // 尾随换行则会让粘贴后立刻执行。
    const text = new TextDecoder()
      .decode(result.representation.bytes)
      .replace(/\r\n/g, '\n')
      .replace(/\r/g, '\n')
      .replace(/\n+$/, '');

    if (!text) {
      this.statusBar.setStatus('Clipboard is empty');
      this.renderer.requestRender();
      return;
    }

    if (this.focus === 'terminal') {
      // 交给终端的 encodePaste：远端开启 bracketed paste 时会自动包上标记，
      // 多行文本不会被逐行执行。
      const tab = this.getActiveTab();
      if (tab?.ssh.isConnected()) {
        const encoded = tab.term.encodePaste(new TextEncoder().encode(text));
        tab.ssh.writeToShell(Buffer.from(encoded).toString('utf8'));
        this.statusBar.setStatus('Pasted to terminal');
      } else {
        this.statusBar.setStatus('Not connected');
      }
    } else if (this.focus === 'form' && this.form) {
      // Insert each character into the form's active field
      for (const ch of text) {
        const fakeKey = createFakeKeyEvent(ch);
        this.form.handleKey(fakeKey);
      }
      this.statusBar.setStatus('Pasted to form');
    } else if (this.focus === 'sftp') {
      // Paste to SFTP command/input buffer
      const activeId = this.tabBar.getActiveTabId();
      if (activeId) {
        const tab = this.tabs.get(activeId);
        if (tab?.sftpTab) {
          tab.sftpTab.pasteText(text);
          this.statusBar.setStatus('Pasted to SFTP');
        }
      }
    } else {
      this.statusBar.setStatus('Nothing to paste to');
    }
    this.renderer.requestRender();
  }

  // ── SFTP handlers ─────────────────────────────────────────────

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

      const sftpTabComponent = createSftpTab(tabId, this.renderer, sftpClient, remotePwd, localPwd);

      this.tabs.set(tabId, {
        term: tab.term,
        ssh: sftpSsh,
        config,
        // 同一个终端渲染对象，备用屏状态也随之共享
        altScreen: tab.altScreen,
        sftpClient,
        sftpTab: sftpTabComponent,
      });

      this.tabBar.addTab(tabId, tabTitle, 'sftp');
      this.statusBar.setStatus('SFTP connected');
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to open SFTP';
      this.statusBar.setStatus(`SFTP error: ${msg}`);
    }
    this.renderer.requestRender();
  }
}
