import { Box, ScrollBox, Text, TextRenderable } from '@opentui/core';
import type { CliRenderer, KeyEvent, MouseEvent } from '@opentui/core';
import { mkdir, readdir, rename, rmdir, stat, unlink } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join, isAbsolute, resolve, sep as pathSep } from 'node:path';
import { SftpClient, isTransferCancelled } from './sftp-client';
import type { FileItem, PanelSide } from './types';
import { createLogger } from '../logger';
import { theme } from '../theme';
import { findBinding, normalizeKey, type KeyContext } from '../keymap';
import type { ConfirmRequest } from '../ui/confirm-dialog';
import { resolveDescendant, resolveNode, type ResolvedNode } from '../ui/resolve';
import { expandRemoteTilde, remoteParentPath, resolveRemotePath } from './paths';
import {
  buildListChunk,
  formatSize,
  getWindowsSystemNames,
  LIST_CHUNK_SIZE,
  readLocalDir,
} from './file-list';
import {
  commonPrefix,
  completeCommandName,
  expandLocalTilde,
  hasTrailingSeparator,
  isSameOrDescendantPath,
  parseCommand,
  pathDisplayName,
  resolveCommandPath,
  resolveCompletionScope,
  resolveDownloadTarget,
  resolveMkdirTarget,
  resolveUploadTarget,
} from './command-parser';

const log = createLogger('sftp-tab');

/** How long a switched-to SFTP tab may reuse its last directory listing. */
const REFRESH_TTL_MS = 2000;
/** Transfer progress is redrawn at most ~10 times per second. */
const PROGRESS_INTERVAL_MS = 100;
/** Command-line history is bounded so long sessions do not grow forever. */
const CMD_HISTORY_LIMIT = 100;
/** Bottom help line; replaced by a cancel hint while a transfer runs. */
const HELP_LINE_DEFAULT = ' :命令  upload download mkdir rm mv cd refresh hidden';
const HELP_LINE_TRANSFER = ' Esc 取消传输 · Esc cancels the running transfer';

/** Human-readable progress line, e.g. `Uploading a.txt 42% (420B/1.0K)`. */
export function formatTransferProgress(label: string, transferred: number, total: number): string {
  if (total <= 0) return `${label} (${formatSize(transferred)})`;
  const percent = Math.min(100, Math.floor((transferred / total) * 100));
  return `${label} ${percent}% (${formatSize(transferred)}/${formatSize(total)})`;
}

// ── Tokyo Night palette ───────────────────────────────────────
const C = {
  bg: theme.appBg,
  surface: theme.panelBg,
  border: theme.border,
  borderActive: theme.focusBorder,
  text: theme.text,
  textDim: theme.textDim,
  blue: theme.accent,
  cyan: theme.cyan,
  green: theme.green,
  yellow: theme.yellow,
  red: theme.red,
  selectedBg: theme.selectionBg,
  statusBarBg: theme.statusBarBg,
};

export interface SftpTabAPI {
  readonly component: ReturnType<typeof Box>;
  readonly id: string;
  handleKey(key: KeyEvent): void;
  pasteText(text: string): void;
  /** 是否处于 `:` 命令行模式（供 keymap 的 when 条件使用）。 */
  isCommandMode(): boolean;
  /** 是否正在上传/下载（供 keymap 的 when 条件使用）。 */
  isTransferring(): boolean;
  focus(): void;
  destroy(): void;
  refresh(): void;
}

interface FileListState {
  currentPath: string;
  items: FileItem[];
  selectedIndex: number;
}

/** Create the SFTP dual-panel tab. */
export function createSftpTab(
  tabId: string,
  renderer: CliRenderer,
  sftpClient: SftpClient,
  remote初始Path: string,
  local初始Path: string,
  /** 右键粘贴请求（剪贴板后端在 App 侧）；仅在命令行模式触发。 */
  requestPaste?: () => void,
  /** 危险操作的二次确认（由 App 提供模态弹窗）；未提供时直接执行。 */
  requestConfirm?: (options: ConfirmRequest) => Promise<boolean>,
): SftpTabAPI {
  const localState: FileListState = {
    currentPath: local初始Path,
    items: [],
    selectedIndex: 0,
  };

  const remoteState: FileListState = {
    currentPath: remote初始Path,
    items: [],
    selectedIndex: 0,
  };

  let activeSide: PanelSide = 'remote';
  let destroyed = false;
  let showSystemFiles = false;

  // ── Command mode state ──────────────────────────────────────────
  let cmdMode = false;
  let cmdBuffer = '';
  let cmdCursorPos = 0;
  let cmdHistory: string[] = [];
  let cmdHistoryIdx = -1;

  // ── Transfer state ─────────────────────────────────────────────
  // 同一时间只允许一个传输；Esc 通过 AbortController 取消它。
  let transferController: AbortController | null = null;

  // ── Build the UI ──────────────────────────────────────────────
  /**
   * Wrap a file list in a ScrollBox: 滚动、滚动条、滚轮都由 OpenTUI 自己管理，
   * 不再手写 `scrollY` 与 ScrollBar 同步。
   */
  function createListScrollBox(id: string, list: ReturnType<typeof Box>) {
    return ScrollBox(
      {
        id,
        width: '100%',
        flexGrow: 1,
        flexBasis: 0,
        scrollY: true,
        scrollX: false,
        viewportCulling: true,
        backgroundColor: C.surface,
        contentOptions: { flexDirection: 'column' },
        scrollbarOptions: {
          width: 1,
          showArrows: false,
          trackOptions: { backgroundColor: C.statusBarBg, foregroundColor: C.textDim },
        },
      },
      list,
    );
  }

  const headerBox = Box(
    { id: 'sftp-header', flexDirection: 'row', height: 1, backgroundColor: C.bg, paddingX: 1 },
    Text({ content: ' SFTP ', fg: C.blue }),
    Text({ content: '|', fg: C.border }),
    Text({ content: ' Tab:切换  Up/Down:选择  Enter:进入  Bksp:上级  ::命令行  Ctrl+U:上传  Ctrl+D:下载 ', fg: C.textDim }),
  );

  // Local panel
  const localPathText = Text({ content: ` Local: ${localState.currentPath}`, fg: C.cyan, id: 'sftp-local-path' });
  const localList = Box(
    { id: 'sftp-local-list', flexDirection: 'column', width: '100%' },
    Text({ content: ' Loading...', fg: C.textDim, wrapMode: 'none', width: '100%' }),
  );
  const localScroll = createListScrollBox('sftp-local-scroll', localList);
  const localPanel = Box(
    { id: 'sftp-local-panel', flexDirection: 'column', flexGrow: 1, flexBasis: 0, backgroundColor: C.surface, paddingX: 1 },
    localPathText,
    Text({ content: '', fg: C.border, width: '100%' }),
    localScroll,
  );

  // Remote panel
  const remotePathText = Text({ content: ` Remote: ${remoteState.currentPath}`, fg: C.cyan, id: 'sftp-remote-path' });
  const remoteList = Box(
    { id: 'sftp-remote-list', flexDirection: 'column', width: '100%' },
    Text({ content: ' Loading...', fg: C.textDim, wrapMode: 'none', width: '100%' }),
  );
  const remoteScroll = createListScrollBox('sftp-remote-scroll', remoteList);
  const remotePanel = Box(
    { id: 'sftp-remote-panel', flexDirection: 'column', flexGrow: 1, flexBasis: 0, backgroundColor: C.surface, paddingX: 1 },
    remotePathText,
    Text({ content: '', fg: C.border, width: '100%' }),
    remoteScroll,
  );

  // Status bar
  const statusText = Text({ content: ' Ready', fg: C.textDim, id: 'sftp-status' });
  const statusBar = Box(
    { id: 'sftp-status-bar', flexDirection: 'row', height: 1, backgroundColor: C.statusBarBg, paddingX: 1 },
    statusText,
  );

  // Help line
  const helpLine = Text({
    content: HELP_LINE_DEFAULT,
    fg: C.textDim,
    id: 'sftp-help-line',
    height: 1,
  });

  // Main container
  // 右键 = 粘贴到命令行；浏览模式没有输入目标，直接无动作
  const mainBox = Box(
    {
      id: tabId,
      flexDirection: 'column',
      width: '100%',
      flexGrow: 1,
      onMouseDown: (e: MouseEvent) => {
        if (e.button !== 2) return;
        e.preventDefault();
        e.stopPropagation();
        if (cmdMode) requestPaste?.();
      },
    },
    headerBox,
    Box(
      { flexDirection: 'row', width: '100%', flexGrow: 1 },
      localPanel,
      remotePanel,
    ),
    statusBar,
    helpLine,
  );

  // ── Resolve real renderables ──────────────────────────────────
  let _resolvedLocalPath: ResolvedNode | null = null;
  let _resolvedLocalList: ResolvedNode | null = null;
  let _resolvedRemotePath: ResolvedNode | null = null;
  let _resolvedRemoteList: ResolvedNode | null = null;
  let _resolvedLocalScroll: ResolvedNode | null = null;
  let _resolvedRemoteScroll: ResolvedNode | null = null;
  let _resolvedStatus: ResolvedNode | null = null;
  let _resolvedHelpLine: ResolvedNode | null = null;
  let _resolvedLocalPanel: ResolvedNode | null = null;
  let _resolvedRemotePanel: ResolvedNode | null = null;

  const listViews: Record<PanelSide, { container: ResolvedNode | null; chunks: TextRenderable[] }> = {
    local: { container: null, chunks: [] },
    remote: { container: null, chunks: [] },
  };

  function resolveAll(): void {
    if (_resolvedLocalPath && _resolvedLocalList && _resolvedRemotePath && _resolvedRemoteList
      && _resolvedLocalScroll && _resolvedRemoteScroll && _resolvedStatus
      && _resolvedHelpLine && _resolvedLocalPanel && _resolvedRemotePanel) {
      return;
    }

    const root = resolveNode(renderer, tabId);
    _resolvedLocalPath = resolveDescendant(root, 'sftp-local-path');
    _resolvedLocalList = resolveDescendant(root, 'sftp-local-list');
    _resolvedRemotePath = resolveDescendant(root, 'sftp-remote-path');
    _resolvedRemoteList = resolveDescendant(root, 'sftp-remote-list');
    _resolvedStatus = resolveDescendant(root, 'sftp-status');
    _resolvedHelpLine = resolveDescendant(root, 'sftp-help-line');
    _resolvedLocalPanel = resolveDescendant(root, 'sftp-local-panel');
    _resolvedRemotePanel = resolveDescendant(root, 'sftp-remote-panel');
    _resolvedLocalScroll = resolveDescendant(root, 'sftp-local-scroll');
    _resolvedRemoteScroll = resolveDescendant(root, 'sftp-remote-scroll');
    // ScrollBox 默认可聚焦；文件列表的按键由本组件统一处理，别让它抢焦点
    if (_resolvedLocalScroll) _resolvedLocalScroll.focusable = false;
    if (_resolvedRemoteScroll) _resolvedRemoteScroll.focusable = false;
  }

  // ── Render functions ──────────────────────────────────────────
  /** 让选中行保持在视口内（ScrollBox 自带滚动，只需按需 scrollTo）。 */
  function ensureIndexVisible(scroll: ResolvedNode | null, index: number): void {
    if (!scroll || scroll.isDestroyed) return;
    const viewport = Math.max(1, Math.floor(scroll.viewport?.height || scroll.height || 1));
    if (index < scroll.scrollTop) {
      scroll.scrollTo(index);
    } else if (index >= scroll.scrollTop + viewport) {
      scroll.scrollTo(index - viewport + 1);
    }
  }

  function renderListChrome(
    state: FileListState,
    pathText: ResolvedNode | null,
    panel: ResolvedNode | null,
    side: PanelSide,
  ): void {
    if (pathText) {
      pathText.content = ` ${side === 'local' ? 'Local' : 'Remote'}: ${state.currentPath}`;
    }
    if (panel) {
      panel.borderColor = side === activeSide ? C.borderActive : C.border;
    }
  }

  /** Build one column of rendered lines; also used to refresh a single chunk. */
  function rebuildList(state: FileListState, side: PanelSide): void {
    const container = side === 'local' ? _resolvedLocalList : _resolvedRemoteList;
    if (!container) return;

    const view = listViews[side];
    view.container = container;
    for (const child of [...container.getChildren()]) {
      container.remove(child);
    }
    view.chunks = [];

    if (state.items.length === 0) {
      const empty = new TextRenderable(renderer.root.ctx, {
        id: `sftp-${side}-empty`,
        content: ' (empty)',
        fg: C.textDim,
        width: '100%',
      });
      container.add(empty);
      view.chunks.push(empty);
      return;
    }

    for (let start = 0; start < state.items.length; start += LIST_CHUNK_SIZE) {
      const end = Math.min(state.items.length, start + LIST_CHUNK_SIZE);
      const text = new TextRenderable(renderer.root.ctx, {
        id: `sftp-${side}-chunk-${start}`,
        content: buildListChunk(state, start, end),
        width: '100%',
        wrapMode: 'none',
      });
      container.add(text);
      view.chunks.push(text);
    }
  }

  /**
   * Redraw only the chunks containing the old and new selection. A cursor
   * move is O(CHUNK_SIZE) instead of O(directory size).
   */
  function updateSelectionChunks(state: FileListState, side: PanelSide, indices: number[]): void {
    if (state.items.length === 0) return;
    const view = listViews[side];
    if (!view.container) return;

    for (const index of new Set(indices)) {
      if (index < 0 || index >= state.items.length) continue;
      const chunkIndex = Math.floor(index / LIST_CHUNK_SIZE);
      const chunk = view.chunks[chunkIndex];
      if (!chunk) continue;
      const start = chunkIndex * LIST_CHUNK_SIZE;
      const end = Math.min(state.items.length, start + LIST_CHUNK_SIZE);
      chunk.content = buildListChunk(state, start, end);
    }
  }

  function renderFileList(state: FileListState, side: PanelSide): void {
    resolveAll();
    const pathText = side === 'local' ? _resolvedLocalPath : _resolvedRemotePath;
    const panel = side === 'local' ? _resolvedLocalPanel : _resolvedRemotePanel;
    const scroll = side === 'local' ? _resolvedLocalScroll : _resolvedRemoteScroll;

    renderListChrome(state, pathText, panel, side);
    rebuildList(state, side);
    ensureIndexVisible(scroll, state.selectedIndex);
  }

  function renderStatus(msg: string, fg?: string): void {
    if (destroyed) return;
    if (_resolvedStatus && !_resolvedStatus.isDestroyed) {
      _resolvedStatus.content = ` ${msg}`;
      _resolvedStatus.fg = fg || C.textDim;
    }
    renderer.requestRender();
  }

  /** 底栏在传输期间提示取消键，结束后恢复默认文案。 */
  function renderHelpLine(transferring: boolean): void {
    if (destroyed) return;
    resolveAll();
    if (_resolvedHelpLine && !_resolvedHelpLine.isDestroyed) {
      _resolvedHelpLine.content = transferring ? HELP_LINE_TRANSFER : HELP_LINE_DEFAULT;
    }
    renderer.requestRender();
  }

  /** 开始一个传输；已有传输在跑时返回 null（拒绝并发）。 */
  function beginTransfer(): AbortController | null {
    if (transferController) return null;
    const controller = new AbortController();
    transferController = controller;
    renderHelpLine(true);
    return controller;
  }

  function endTransfer(controller: AbortController): void {
    if (transferController !== controller) return;
    transferController = null;
    renderHelpLine(false);
  }

  /**
   * Throttled transfer progress reporter. The copy loop fires once per chunk;
   * redrawing each time would flood the render loop.
   */
  function createProgressReporter(
    label: string,
  ): (transferred: number, total: number) => void {
    let lastRenderedAt = 0;
    let lastBytes = 0;
    let lastSampleAt = Date.now();

    return (transferred, total) => {
      const now = Date.now();
      const finished = total > 0 && transferred >= total;
      if (!finished && now - lastRenderedAt < PROGRESS_INTERVAL_MS) return;
      lastRenderedAt = now;

      const elapsed = Math.max(1, now - lastSampleAt) / 1000;
      const speed = Math.max(0, (transferred - lastBytes) / elapsed);
      lastBytes = transferred;
      lastSampleAt = now;

      const speedText = speed > 0 ? ` ${formatSize(speed)}/s` : '';
      renderStatus(`${formatTransferProgress(label, transferred, total)}${speedText}`, C.yellow);
    };
  }

  // ── Data loading ──────────────────────────────────────────────
  let localLoadToken = 0;
  let remoteLoadToken = 0;
  let lastRefreshAt = 0;
  let refreshInFlight: Promise<void> | null = null;
  let remoteHomePath: string | null = null;

  /** Resolve and cache the remote home directory (for `~` expansion). */
  async function getRemoteHome(): Promise<string> {
    if (remoteHomePath === null) {
      remoteHomePath = await sftpClient.realpath('.');
    }
    return remoteHomePath;
  }

  /** Expand a command argument's leading `~`; leave it untouched on failure. */
  async function expandRemoteArg(value: string): Promise<string> {
    if (value !== '~' && !value.startsWith('~/')) return value;
    try {
      return expandRemoteTilde(value, await getRemoteHome());
    } catch (err) {
      log.debug(`[SFTP] could not resolve remote home: ${err}`);
      return value;
    }
  }

  function expandLocalArg(value: string): string {
    return expandLocalTilde(value, homedir());
  }

  async function isRemoteDirectory(path: string): Promise<boolean> {
    try {
      return (await sftpClient.stat(path)).isDirectory();
    } catch {
      return false;
    }
  }

  async function isLocalDirectory(path: string): Promise<boolean> {
    try {
      return (await stat(path)).isDirectory();
    } catch {
      return false;
    }
  }

  async function loadRemoteDir(path: string): Promise<void> {
    const token = ++remoteLoadToken;
    log.debug(`[SFTP LOAD REMOTE] path:${path}`);
    try {
      if (path === '~' || path.startsWith('~/')) {
        path = expandRemoteTilde(path, await getRemoteHome());
      }
      if (token !== remoteLoadToken || destroyed) return;

      const items = await sftpClient.readdir(path);
      if (token !== remoteLoadToken || destroyed) return;

      remoteState.items = items;
      remoteState.currentPath = path;
      remoteState.selectedIndex = 0;
      renderFileList(remoteState, 'remote');
      renderer.requestRender();
    } catch (err) {
      if (token !== remoteLoadToken || destroyed) return;
      log.debug(`[SFTP LOAD REMOTE] error: ${err}`);
      const msg = err instanceof Error ? err.message : 'Failed to read remote directory';
      renderStatus(`Error: ${msg}`, C.red);
    }
  }

  async function loadLocalDir(path: string): Promise<void> {
    const token = ++localLoadToken;
    try {
      // Resolve relative paths against current panel directory
      const actualPath = isAbsolute(path) ? path : resolve(localState.currentPath, path);
      if (token !== localLoadToken || destroyed) return;

      const items = await readLocalDir(actualPath, !showSystemFiles);
      if (token !== localLoadToken || destroyed) return;

      localState.items = items;
      localState.currentPath = actualPath;
      localState.selectedIndex = 0;
      renderFileList(localState, 'local');
      renderer.requestRender();
    } catch (err) {
      if (token !== localLoadToken || destroyed) return;
      log.debug(`[SFTP LOAD LOCAL] error: ${err}`);
      const msg = err instanceof Error ? err.message : 'Failed to read local directory';
      renderStatus(`Error: ${msg}`, C.red);
    }
  }

  /** 刷新两个面板；force=false 用于切标签页时的 TTL 缓存。 */
  async function refreshBoth(verbose = true, force = true): Promise<void> {
    if (!force && Date.now() - lastRefreshAt < REFRESH_TTL_MS) return;
    if (verbose) renderStatus('Refreshing...');
    await Promise.all([
      loadLocalDir(localState.currentPath),
      loadRemoteDir(remoteState.currentPath),
    ]);
    if (destroyed) return;
    lastRefreshAt = Date.now();
    if (verbose) renderStatus('Refreshed', C.green);
  }

  // ── Navigation ────────────────────────────────────────────────
  async function enterDirectory(side: PanelSide): Promise<void> {
    const state = side === 'local' ? localState : remoteState;
    const item = state.items[state.selectedIndex];
    if (!item || !item.isDirectory) return;

    let newPath: string;
    if (side === 'local') {
      // node:path handles Windows/Unix joining correctly
      newPath = join(state.currentPath, item.name);
    } else {
      // Remote is always Unix-style paths
      const sep = state.currentPath.endsWith('/') ? '' : '/';
      newPath = `${state.currentPath}${sep}${item.name}`;
    }

    renderStatus(`Entering ${newPath}...`);
    if (side === 'local') {
      await loadLocalDir(newPath);
    } else {
      await loadRemoteDir(newPath);
    }
  }

  async function goUp(side: PanelSide): Promise<void> {
    const state = side === 'local' ? localState : remoteState;

    if (side === 'local') {
      const parent = dirname(state.currentPath);
      if (parent === state.currentPath) return; // Already at root
      renderStatus(`Going to ${parent}...`);
      await loadLocalDir(parent);
    } else {
      // Remote is always Unix-style paths; `remoteParentPath` allows /home → /.
      const newPath = remoteParentPath(state.currentPath);
      if (newPath === null) return;
      renderStatus(`Going to ${newPath}...`);
      await loadRemoteDir(newPath);
    }
  }

  // ── Command mode ──────────────────────────────────────────────
  function enterCommandMode(initial: string = ''): void {
    cmdMode = true;
    cmdBuffer = initial;
    cmdCursorPos = initial.length;
    renderStatus(`> ${cmdBuffer}_`);
    renderer.requestRender();
  }

  // ── 路径解析（rm / mv 共用）─────────────────────────────────────
  /** 把命令参数解析成绝对路径：本地走 node:path，远端按 '/' 拼接 */
  function toAbsPath(p: string): string {
    return resolveCommandPath(
      activeSide,
      localState.currentPath,
      remoteState.currentPath,
      p,
    );
  }

  /** 取路径最后一段，用于提示文案 */
  function pathName(p: string): string {
    return pathDisplayName(activeSide, p);
  }

  /** 判断路径是否为目录；不依赖列表缓存，因此支持当前目录之外的路径 */
  async function isDirectoryPath(p: string): Promise<boolean> {
    if (activeSide === 'remote') {
      const attrs = await sftpClient.stat(p);
      return attrs.isDirectory();
    }
    return (await stat(p)).isDirectory();
  }

  /** Reload the panel that owns the mutation (local or remote). */
  async function reloadActivePanel(): Promise<void> {
    if (activeSide === 'local') {
      await loadLocalDir(localState.currentPath);
    } else {
      await loadRemoteDir(remoteState.currentPath);
    }
  }

  async function executeCommand(input: string): Promise<boolean> {
    const { command: cmd, args } = parseCommand(input);
    let ok = true;

    log.debug(`[SFTP CMD] cmd:${cmd} args:${JSON.stringify(args)} activeSide:${activeSide}`);

    switch (cmd) {
      case 'upload': {
        // upload <source> [dest]
        if (args.length < 1) {
          renderStatus('Usage: upload <local_path> [remote_path]', C.red);
          return false;
        }
        const source = expandLocalArg(args[0]);
        const rawDest = args[1] === undefined ? undefined : await expandRemoteArg(args[1]);
        const target = resolveUploadTarget(remoteState.currentPath, source, rawDest);
        const localPath = isAbsolute(target.localPath)
          ? target.localPath
          : resolve(localState.currentPath, target.localPath);
        const { fileName } = target;
        let remotePath = target.remotePath;
        // `upload a.txt docs` (no trailing slash) still means "into docs".
        if (rawDest && !hasTrailingSeparator(rawDest) && await isRemoteDirectory(remotePath)) {
          remotePath = resolveRemotePath(remotePath, fileName);
        }
        const controller = beginTransfer();
        if (!controller) {
          renderStatus('Another transfer is running — press Esc to cancel it', C.yellow);
          return false;
        }
        renderStatus(`Uploading ${localPath} → ${remotePath}... (Esc to cancel)`, C.yellow);
        try {
          await sftpClient.upload(localPath, remotePath, {
            signal: controller.signal,
            onProgress: createProgressReporter(`Uploading ${fileName}`),
          });
          renderStatus(`Uploaded: ${fileName}`, C.green);
          await loadRemoteDir(remoteState.currentPath);
          return true;
        } catch (err) {
          if (isTransferCancelled(err)) {
            renderStatus(`Upload cancelled: ${fileName}`, C.yellow);
            await loadRemoteDir(remoteState.currentPath);
            return false;
          }
          const msg = err instanceof Error ? err.message : 'Upload failed';
          log.error(`[SFTP UPLOAD] ${localPath} → ${remotePath}: ${msg}`);
          renderStatus(`Upload failed: ${msg}`, C.red);
          return false;
        } finally {
          endTransfer(controller);
        }
      }
      case 'download': {
        // download <source> [dest]
        if (args.length < 1) {
          renderStatus('Usage: download <remote_path> [local_path]', C.red);
          return false;
        }
        const rawSource = await expandRemoteArg(args[0]);
        const rawDest = args[1] === undefined ? undefined : expandLocalArg(args[1]);
        const target = resolveDownloadTarget(
          localState.currentPath,
          resolveRemotePath(remoteState.currentPath, rawSource),
          rawDest,
        );
        const { remotePath, fileName } = target;
        let localPath = target.localPath;
        // `download f dir` (no trailing slash) still means "into dir".
        if (rawDest && !hasTrailingSeparator(rawDest) && await isLocalDirectory(localPath)) {
          localPath = resolve(localPath, fileName);
        }
        const controller = beginTransfer();
        if (!controller) {
          renderStatus('Another transfer is running — press Esc to cancel it', C.yellow);
          return false;
        }
        renderStatus(`Downloading ${remotePath} → ${localPath}... (Esc to cancel)`, C.yellow);
        try {
          await sftpClient.download(remotePath, localPath, {
            signal: controller.signal,
            onProgress: createProgressReporter(`Downloading ${fileName}`),
          });
          renderStatus(`Downloaded: ${fileName}`, C.green);
          await loadLocalDir(localState.currentPath);
          return true;
        } catch (err) {
          if (isTransferCancelled(err)) {
            renderStatus(`Download cancelled: ${fileName}`, C.yellow);
            await loadLocalDir(localState.currentPath);
            return false;
          }
          const msg = err instanceof Error ? err.message : 'Download failed';
          log.error(`[SFTP DOWNLOAD] ${remotePath} → ${localPath}: ${msg}`);
          renderStatus(`Download failed: ${msg}`, C.red);
          return false;
        } finally {
          endTransfer(controller);
        }
      }
      case 'mkdir': {
        if (args.length < 1) {
          renderStatus('Usage: mkdir <name>', C.red);
          return false;
        }
        const name = activeSide === 'remote'
          ? await expandRemoteArg(args[0])
          : expandLocalArg(args[0]);
        const fullPath = resolveMkdirTarget(
          activeSide,
          localState.currentPath,
          remoteState.currentPath,
          name,
        );
        try {
          if (activeSide === 'remote') {
            await sftpClient.mkdir(fullPath);
          } else {
            await mkdir(fullPath);
          }
          renderStatus(`Created: ${name}`, C.green);
          await reloadActivePanel();
        } catch (err) {
          const msg = err instanceof Error ? err.message : 'Mkdir failed';
          log.error(`[SFTP MKDIR] ${fullPath}: ${msg}`);
          renderStatus(`Mkdir failed: ${msg}`, C.red);
          ok = false;
        }
        break;
      }
      case 'rm': {
        if (args.length > 1) {
          renderStatus('Usage: rm [path]', C.red);
          return false;
        }
        const state = activeSide === 'local' ? localState : remoteState;
        let fullPath: string;
        let name: string;
        let isDirHint: boolean | undefined;
        if (args.length === 0) {
          const item = state.items[state.selectedIndex];
          if (!item) {
            renderStatus('Nothing selected', C.red);
            return false;
          }
          fullPath = toAbsPath(item.name);
          name = item.name;
          isDirHint = item.isDirectory;
        } else {
          const rawPath = activeSide === 'remote'
            ? await expandRemoteArg(args[0])
            : expandLocalArg(args[0]);
          fullPath = toAbsPath(rawPath);
          name = pathName(fullPath);
        }
        try {
          const isDir = isDirHint ?? await isDirectoryPath(fullPath);
          if (requestConfirm) {
            const confirmed = await requestConfirm({
              title: activeSide === 'remote' ? 'Delete remote item' : 'Delete local item',
              message: `Delete ${isDir ? 'directory' : 'file'} "${name}"?${
                isDir ? ' The directory must be empty.' : ''
              } This cannot be undone.`,
              confirmLabel: 'Delete',
              danger: true,
            });
            if (!confirmed) {
              renderStatus('Delete cancelled', C.yellow);
              return false;
            }
          }
          if (activeSide === 'remote') {
            if (isDir) {
              await sftpClient.rmdir(fullPath);
            } else {
              await sftpClient.unlink(fullPath);
            }
          } else {
            if (isDir) {
              await rmdir(fullPath);
            } else {
              await unlink(fullPath);
            }
          }
          renderStatus(`Deleted: ${name}`, C.green);
          await reloadActivePanel();
        } catch (err) {
          const msg = err instanceof Error ? err.message : 'Delete failed';
          log.error(`[SFTP RM] ${fullPath}: ${msg}`);
          renderStatus(`rm failed: ${msg}`, C.red);
          ok = false;
        }
        break;
      }
      case 'mv': {
        if (args.length !== 2) {
          renderStatus('Usage: mv <src> <dst>', C.red);
          return false;
        }
        const srcArg = activeSide === 'remote'
          ? await expandRemoteArg(args[0])
          : expandLocalArg(args[0]);
        const dstArg = activeSide === 'remote'
          ? await expandRemoteArg(args[1])
          : expandLocalArg(args[1]);
        const oldPath = toAbsPath(srcArg);
        let newPath = toAbsPath(dstArg);
        // dst 是已存在的目录（或以分隔符结尾）→ 移入该目录，保留原文件名
        let dstIsDir = hasTrailingSeparator(dstArg);
        if (!dstIsDir) {
          try {
            dstIsDir = await isDirectoryPath(newPath);
          } catch {
            // dst 不存在 → 按改名处理
          }
        }
        if (dstIsDir) {
          newPath = activeSide === 'local'
            ? join(newPath, pathName(oldPath))
            : resolveRemotePath(newPath, pathName(oldPath));
        }
        if (oldPath === newPath) {
          renderStatus('Source and destination are the same', C.red);
          return false;
        }
        if (isSameOrDescendantPath(activeSide, oldPath, newPath)) {
          renderStatus('Cannot move a directory into itself', C.red);
          return false;
        }
        try {
          if (activeSide === 'remote') {
            await sftpClient.rename(oldPath, newPath);
          } else {
            await rename(oldPath, newPath);
          }
          renderStatus(`Moved: ${pathName(oldPath)} → ${pathName(newPath)}`, C.green);
          await reloadActivePanel();
        } catch (err) {
          const msg = err instanceof Error ? err.message : 'mv failed';
          log.error(`[SFTP MV] ${oldPath} → ${newPath}: ${msg}`);
          renderStatus(`mv failed: ${msg}`, C.red);
          ok = false;
        }
        break;
      }
      case 'cd': {
        if (args.length < 1) {
          renderStatus('Usage: cd <path>', C.red);
          return false;
        }
        let targetPath = activeSide === 'remote'
          ? await expandRemoteArg(args[0])
          : expandLocalArg(args[0]);
        // Resolve relative path for remote side
        if (activeSide === 'remote') {
          targetPath = resolveRemotePath(remoteState.currentPath, targetPath);
        }
        log.debug(`[SFTP CD] raw:${args[0]} resolved:${targetPath}`);
        renderStatus(`Changing directory: ${targetPath}...`, C.yellow);
        try {
          if (activeSide === 'local') {
            await loadLocalDir(targetPath);
          } else {
            await loadRemoteDir(targetPath);
          }
          // Also refresh the other side
          if (activeSide === 'local') {
            await loadRemoteDir(remoteState.currentPath);
          } else {
            await loadLocalDir(localState.currentPath);
          }
          renderStatus(`Changed to: ${activeSide === 'local' ? localState.currentPath : remoteState.currentPath}`, C.green);
        } catch (err) {
          const msg = err instanceof Error ? err.message : 'cd failed';
          log.error(`[SFTP CD] ${targetPath}: ${msg}`);
          renderStatus(`cd failed: ${msg}`, C.red);
          ok = false;
        }
        break;
      }
      case 'refresh': {
        await refreshBoth();
        break;
      }
      case 'hidden': {
        showSystemFiles = args[0] !== 'off';
        renderStatus(showSystemFiles ? 'System files: shown' : 'System files: hidden', C.yellow);
        await loadLocalDir(localState.currentPath);
        break;
      }
      default:
        renderStatus(`Unknown command: ${cmd}`, C.red);
        ok = false;
    }
    return ok;
  }

  // ── Tab completion in command mode ─────────────────────────────
  async function handleCommandTabCompletion(): Promise<void> {
    const before = cmdBuffer.slice(0, cmdCursorPos);
    const after = cmdBuffer.slice(cmdCursorPos);
    const parts = before.split(/\s+/);
    const isFirstToken = parts.length <= 1;
    const currentToken = parts[parts.length - 1] || '';

    if (isFirstToken) {
      // Complete command name
      const matches = completeCommandName(currentToken);
      if (matches.length === 1) {
        parts[parts.length - 1] = matches[0];
        cmdBuffer = parts.join(' ') + ' ' + after;
        cmdCursorPos = cmdBuffer.length - after.length;
      } else if (matches.length > 1) {
        renderStatus(`Candidates: ${matches.join(', ')}`, C.cyan);
      }
    } else {
      // Complete file path
      const state = activeSide === 'local' ? localState : remoteState;
      const sep = activeSide === 'local' ? pathSep : '/';
      const scope = resolveCompletionScope(activeSide, state.currentPath, currentToken);

      // Get file list for completion
      let items: FileItem[] = [];
      try {
        if (activeSide === 'remote') {
          items = await sftpClient.readdir(scope.directory);
        } else {
          const systemNames = await getWindowsSystemNames(scope.directory);
          const entries = await readdir(scope.directory, { withFileTypes: true });
          items = entries
            .filter(e => e.name !== '.' && e.name !== '..' && !systemNames.has(e.name))
            .map(e => ({
              name: e.name,
              isDirectory: e.isDirectory(),
              isFile: e.isFile(),
              isSymlink: e.isSymbolicLink?.() ?? false,
              size: 0,
              mode: 0,
              mtime: 0,
              longname: '',
            }));
        }
      } catch {
        // If directory read fails, just return
        return;
      }

      const matches = items.filter(i => i.name.startsWith(scope.prefix));
      if (matches.length === 1) {
        const match = matches[0];
        const completedName = scope.tokenPrefix + match.name;
        const suffix = match.isDirectory ? sep : ' ';
        parts[parts.length - 1] = completedName + suffix;
        cmdBuffer = parts.join(' ') + after;
        cmdCursorPos = cmdBuffer.length - after.length;
      } else if (matches.length > 1) {
        // Complete common prefix
        const common = commonPrefix(matches.map((match) => match.name));
        if (common.length > scope.prefix.length) {
          const completedName = scope.tokenPrefix + common;
          parts[parts.length - 1] = completedName;
          cmdBuffer = parts.join(' ') + after;
          cmdCursorPos = cmdBuffer.length - after.length;
        }
        renderStatus(`Candidates: ${matches.slice(0, 8).map(m => m.name + (m.isDirectory ? '/' : '')).join('  ')}${matches.length > 8 ? '  ...' : ''}`, C.cyan);
      }
    }

    renderStatus(`> ${cmdBuffer}_`);
    renderer.requestRender();
  }

  // ── Paste text into active input ──────────────────────────────
  function pasteText(text: string): void {
    if (cmdMode) {
      cmdBuffer = cmdBuffer.slice(0, cmdCursorPos) + text + cmdBuffer.slice(cmdCursorPos);
      cmdCursorPos += text.length;
      renderStatus(`> ${cmdBuffer}_`);
      renderer.requestRender();
    }
  }

  // ── Keyboard handling ─────────────────────────────────────────
  /** 当前面板上下移动 N 行（翻页也复用它）。 */
  function moveSelection(delta: number): void {
    const state = activeSide === 'local' ? localState : remoteState;
    if (state.items.length === 0) return;
    const next = Math.max(0, Math.min(state.items.length - 1, state.selectedIndex + delta));
    if (next === state.selectedIndex) return;

    const previous = state.selectedIndex;
    state.selectedIndex = next;
    updateSelectionChunks(state, activeSide, [previous, next]);
    ensureIndexVisible(
      activeSide === 'local' ? _resolvedLocalScroll : _resolvedRemoteScroll,
      next,
    );
    renderer.requestRender();
  }

  /** PageUp/PageDown 的步长 = 当前列表视口高度 - 1。 */
  function pageStep(): number {
    const scroll = activeSide === 'local' ? _resolvedLocalScroll : _resolvedRemoteScroll;
    const viewport = Math.floor(scroll?.viewport?.height || 10);
    return Math.max(1, viewport - 1);
  }

  async function handleKey(key: KeyEvent): Promise<void> {
    if (destroyed) return;

    const k = normalizeKey(key);
    const ctx: KeyContext = {
      focus: 'sftp',
      helpOpen: false,
      formOpen: false,
      confirmOpen: false,
      sftpCmdMode: cmdMode,
      sftpTransferring: transferController !== null,
      formField: -1,
      activeTabType: 'sftp',
    };
    const binding = findBinding('sftp', k, ctx);
    log.debug(`[SFTP KEY] name:${k.name} ctrl:${k.ctrl} cmd:${cmdMode} binding:${binding?.id ?? '-'}`);

    switch (binding?.id) {
      // ── 传输取消（Esc，优先于退出命令行模式）───────────────────
      case 'sftp.cancelTransfer':
        if (transferController) {
          renderStatus('Cancelling transfer...', C.yellow);
          transferController.abort();
        }
        return;

      // ── 命令行模式 ────────────────────────────────────────────
      case 'sftp.cmd.execute': {
        const cmd = cmdBuffer.trim();
        cmdBuffer = '';
        cmdCursorPos = 0;
        if (cmd) {
          cmdHistory.push(cmd);
          // Keep the history bounded for long-running sessions.
          if (cmdHistory.length > CMD_HISTORY_LIMIT) cmdHistory.shift();
          cmdHistoryIdx = cmdHistory.length;
          const ok = await executeCommand(cmd);
          if (ok) {
            renderStatus('> ');
            renderer.requestRender();
          }
        }
        return;
      }
      case 'sftp.cmd.cancel':
        cmdMode = false;
        cmdBuffer = '';
        cmdCursorPos = 0;
        renderStatus('Ready');
        return;
      case 'sftp.cmd.backspace':
        if (cmdCursorPos > 0) {
          cmdBuffer = cmdBuffer.slice(0, cmdCursorPos - 1) + cmdBuffer.slice(cmdCursorPos);
          cmdCursorPos--;
          renderStatus(`> ${cmdBuffer}_`);
          renderer.requestRender();
        }
        return;
      case 'sftp.cmd.historyPrev':
        if (cmdHistoryIdx > 0) {
          cmdHistoryIdx--;
          cmdBuffer = cmdHistory[cmdHistoryIdx];
          cmdCursorPos = cmdBuffer.length;
          renderStatus(`> ${cmdBuffer}_`);
          renderer.requestRender();
        }
        return;
      case 'sftp.cmd.historyNext':
        if (cmdHistoryIdx < cmdHistory.length - 1) {
          cmdHistoryIdx++;
          cmdBuffer = cmdHistory[cmdHistoryIdx];
        } else {
          cmdHistoryIdx = cmdHistory.length;
          cmdBuffer = '';
        }
        cmdCursorPos = cmdBuffer.length;
        renderStatus(`> ${cmdBuffer}_`);
        renderer.requestRender();
        return;
      case 'sftp.cmd.left':
        if (cmdCursorPos > 0) {
          cmdCursorPos--;
          renderer.requestRender();
        }
        return;
      case 'sftp.cmd.right':
        if (cmdCursorPos < cmdBuffer.length) {
          cmdCursorPos++;
          renderer.requestRender();
        }
        return;
      case 'sftp.cmd.home':
        cmdCursorPos = 0;
        renderer.requestRender();
        return;
      case 'sftp.cmd.end':
        cmdCursorPos = cmdBuffer.length;
        renderer.requestRender();
        return;
      case 'sftp.cmd.complete':
        await handleCommandTabCompletion();
        return;

      // ── 浏览模式 ──────────────────────────────────────────────
      case 'sftp.switchPanel':
        activeSide = activeSide === 'local' ? 'remote' : 'local';
        resolveAll();
        renderListChrome(localState, _resolvedLocalPath, _resolvedLocalPanel, 'local');
        renderListChrome(remoteState, _resolvedRemotePath, _resolvedRemotePanel, 'remote');
        ensureIndexVisible(
          activeSide === 'local' ? _resolvedLocalScroll : _resolvedRemoteScroll,
          activeSide === 'local' ? localState.selectedIndex : remoteState.selectedIndex,
        );
        renderStatus(`Panel: ${activeSide === 'local' ? 'Local' : 'Remote'}`);
        renderer.requestRender();
        return;
      case 'sftp.up':
        moveSelection(-1);
        return;
      case 'sftp.down':
        moveSelection(1);
        return;
      case 'sftp.pageUp':
        moveSelection(-pageStep());
        return;
      case 'sftp.pageDown':
        moveSelection(pageStep());
        return;
      case 'sftp.enter':
        await enterDirectory(activeSide);
        return;
      case 'sftp.parent':
        await goUp(activeSide);
        return;
      case 'sftp.commandMode':
        enterCommandMode();
        return;
      case 'sftp.prefillUpload': {
        const item = localState.items[localState.selectedIndex];
        if (item && !item.isDirectory) {
          const localPath = join(localState.currentPath, item.name);
          const remotePath = resolveRemotePath(remoteState.currentPath, item.name);
          enterCommandMode(`upload ${localPath} ${remotePath}`);
        } else {
          renderStatus('Select a file in Local panel first', C.yellow);
        }
        return;
      }
      case 'sftp.prefillDownload': {
        const item = remoteState.items[remoteState.selectedIndex];
        if (item && !item.isDirectory) {
          const remotePath = resolveRemotePath(remoteState.currentPath, item.name);
          const localPath = join(localState.currentPath, item.name);
          enterCommandMode(`download ${remotePath} ${localPath}`);
        } else {
          renderStatus('Select a file in Remote panel first', C.yellow);
        }
        return;
      }
      default:
        break;
    }

    // 命令行模式下：可打印字符写入缓冲区（没有对应绑定，属于自由输入）
    if (cmdMode && k.printable) {
      cmdBuffer = cmdBuffer.slice(0, cmdCursorPos) + k.sequence + cmdBuffer.slice(cmdCursorPos);
      cmdCursorPos += k.sequence.length;
      renderStatus(`> ${cmdBuffer}_`);
      renderer.requestRender();
    }
  }

  // ── Initial load ──────────────────────────────────────────────
  log.debug(`[SFTP INIT] localPath:${local初始Path} remotePath:${remote初始Path}`);
  loadLocalDir(local初始Path);
  // Resolve ~ to actual path before listing
  (async () => {
    try {
      // Try realpath('.') first (resolves to current dir = home)
      log.debug(`[SFTP INIT] realpath resolving . ...`);
      const resolved = await sftpClient.realpath('.');
      log.debug(`[SFTP INIT] resolved to ${resolved}`);
      await loadRemoteDir(resolved);
    } catch (err) {
      log.debug(`[SFTP INIT] realpath('.') failed, trying /: ${err}`);
      try {
        await loadRemoteDir('/');
      } catch (err2) {
        log.debug(`[SFTP INIT] loadRemoteDir('/') failed: ${err2}`);
        renderStatus(`Error: ${err2}`, C.red);
      }
    }
  })();

  return {
    component: mainBox,
    id: tabId,

    handleKey,

    pasteText,

    isCommandMode(): boolean {
      return cmdMode;
    },

    isTransferring(): boolean {
      return transferController !== null;
    },

    focus(): void {
      renderFileList(localState, 'local');
      renderFileList(remoteState, 'remote');
      renderer.requestRender();
    },

    destroy(): void {
      destroyed = true;
      localLoadToken++;
      remoteLoadToken++;
      // 关闭标签时中止进行中的传输，否则 ssh2 会继续往已销毁的组件写进度。
      transferController?.abort();
      sftpClient.close();
    },

    refresh(): Promise<void> {
      if (refreshInFlight) return refreshInFlight;
      if (Date.now() - lastRefreshAt < REFRESH_TTL_MS) return Promise.resolve();

      const task = refreshBoth(false, false)
        .catch((err: unknown) => {
          log.error('SFTP refresh failed: {reason}', {
            reason: err instanceof Error ? err.message : String(err),
          });
        })
        .finally(() => {
          refreshInFlight = null;
        });
      refreshInFlight = task;
      return task;
    },
  };
}
