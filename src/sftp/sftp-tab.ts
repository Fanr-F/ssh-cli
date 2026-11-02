import { Box, ScrollBox, Text, TextRenderable, StyledText, type TextChunk } from '@opentui/core';
import type { CliRenderer, KeyEvent } from '@opentui/core';
import { readdir, stat as fsStat } from 'node:fs/promises';
import { SftpClient } from './sftp-client';
import type { FileItem, PanelSide } from './types';
import { createLogger } from '../logger';
import { toRGBA } from '../color';
import { findBinding, normalizeKey, type KeyContext } from '../keymap';
import { basename, isAbsolute, join, resolve, sep as pathSep } from 'node:path';
import { remoteParentPath, resolveRemotePath } from './paths';

const log = createLogger('sftp-tab');

const KNOWN_COMMANDS = ['upload', 'download', 'mkdir', 'rm', 'mv', 'cd', 'refresh', 'hidden'];

/** One-line items are rendered in chunks so moving the cursor is not O(n). */
const LIST_CHUNK_SIZE = 32;
/** Concurrent stat calls for local directories. */
const LOCAL_STAT_CONCURRENCY = 32;
/** How long a switched-to SFTP tab may reuse its last directory listing. */
const REFRESH_TTL_MS = 2000;
/** Windows `attrib` is expensive; cache system-file names briefly. */
const SYSTEM_NAMES_TTL_MS = 10_000;
const systemNamesCache = new Map<string, { names: Set<string>; expiresAt: number }>();

// ── Tokyo Night palette ───────────────────────────────────────
const C = {
  bg: '#16161e',
  surface: '#1a1b26',
  border: '#3b4261',
  borderActive: '#7aa2f7',
  text: '#c0caf5',
  textDim: '#565f89',
  textActive: '#c0caf5',
  blue: '#7aa2f7',
  cyan: '#7dcfff',
  green: '#9ece6a',
  yellow: '#e0af68',
  red: '#f7768e',
  dirFg: '#7aa2f7',
  fileFg: '#c0caf5',
  execFg: '#9ece6a',
  selectedBg: '#33467c',
  statusBarBg: '#24283b',
};

export interface SftpTabAPI {
  readonly component: ReturnType<typeof Box>;
  readonly id: string;
  handleKey(key: KeyEvent): void;
  pasteText(text: string): void;
  getSelectedFilePath(): string | null;
  /** 是否处于 `:` 命令行模式（供 keymap 的 when 条件使用）。 */
  isCommandMode(): boolean;
  focus(): void;
  destroy(): void;
  refresh(): void;
}

interface FileListState {
  currentPath: string;
  items: FileItem[];
  selectedIndex: number;
}

/**
 * Collect names of Windows system-protected files (System attribute) in a
 * directory. Node's fs.stat does not expose DOS attributes, so we shell out to
 * `attrib` once per directory. Returns an empty set on non-Windows platforms or
 * if `attrib` fails (graceful degradation: show everything).
 */
async function getWindowsSystemNames(dir: string): Promise<Set<string>> {
  const names = new Set<string>();
  if (process.platform !== 'win32') return names;

  const cached = systemNamesCache.get(dir);
  if (cached && cached.expiresAt > Date.now()) return cached.names;

  try {
    const { execFile } = await import('node:child_process');
    const output = await new Promise<string>((resolve, reject) => {
      execFile('attrib', [`${dir}\\*`], { windowsHide: true }, (err, stdout) => {
        if (err) reject(err);
        else resolve(stdout);
      });
    });
    for (const line of output.split(/\r?\n/)) {
      const sep = line.indexOf(':');
      if (sep < 0) continue;
      const flags = line.slice(0, sep);
      if (flags.includes('S')) {
        names.add(basename(line.slice(sep - 1)));
      }
    }
    if (systemNamesCache.size > 64) systemNamesCache.clear();
    systemNamesCache.set(dir, { names, expiresAt: Date.now() + SYSTEM_NAMES_TTL_MS });
  } catch {
    // attrib unavailable — fall back to showing everything
  }
  return names;
}

/** Read local directory contents. */
async function readLocalDir(path: string, hideSystem = true): Promise<FileItem[]> {
  const entries = await readdir(path, { withFileTypes: true });
  const systemNames = hideSystem ? await getWindowsSystemNames(path) : new Set<string>();
  const visible = entries.filter(
    (entry) => entry.name !== '.' && entry.name !== '..' && !systemNames.has(entry.name),
  );
  const items: FileItem[] = [];

  // Batch stat calls instead of awaiting them one by one. This is the main
  // difference between a fast and a visibly stalling large directory.
  for (let offset = 0; offset < visible.length; offset += LOCAL_STAT_CONCURRENCY) {
    const batch = visible.slice(offset, offset + LOCAL_STAT_CONCURRENCY);
    const results = await Promise.all(batch.map(async (entry): Promise<FileItem | null> => {
      try {
        const fullPath = join(path, entry.name);
        // `stat` follows symlinks, so a symlink to a directory is navigable
        // and is classified consistently with the target it points at.
        const stats = await fsStat(fullPath);
        return {
          name: entry.name,
          isDirectory: stats.isDirectory(),
          isFile: stats.isFile(),
          isSymlink: entry.isSymbolicLink(),
          size: stats.size,
          mode: stats.mode,
          mtime: Math.floor(stats.mtimeMs / 1000),
          longname: '',
        };
      } catch {
        // Skip files we can't stat
        return null;
      }
    }));
    for (const item of results) {
      if (item) items.push(item);
    }
  }

  items.sort((a, b) => {
    if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1;
    return a.name.localeCompare(b.name);
  });

  return items;
}

/** Format file size for display. */
function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}K`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)}M`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)}G`;
}

/** Format timestamp for display. */
function formatTime(ts: number): string {
  const d = new Date(ts * 1000);
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  const hour = String(d.getHours()).padStart(2, '0');
  const min = String(d.getMinutes()).padStart(2, '0');
  return `${month}-${day} ${hour}:${min}`;
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
    content: ' :命令  upload download mkdir rm mv cd refresh hidden',
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
      onMouseDown: (e: any) => {
        if (e.button !== 2) return;
        e.preventDefault?.();
        e.stopPropagation?.();
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
  let _resolvedLocalPath: any = null;
  let _resolvedLocalList: any = null;
  let _resolvedRemotePath: any = null;
  let _resolvedRemoteList: any = null;
  let _resolvedLocalScroll: any = null;
  let _resolvedRemoteScroll: any = null;
  let _resolvedStatus: any = null;
  let _resolvedLocalPanel: any = null;
  let _resolvedRemotePanel: any = null;

  const listViews: Record<PanelSide, { container: any; chunks: any[] }> = {
    local: { container: null, chunks: [] },
    remote: { container: null, chunks: [] },
  };

  function resolveAll(): void {
    if (_resolvedLocalPath && _resolvedLocalList && _resolvedRemotePath && _resolvedRemoteList
      && _resolvedLocalScroll && _resolvedRemoteScroll && _resolvedStatus
      && _resolvedLocalPanel && _resolvedRemotePanel) {
      return;
    }

    const root = renderer.root.findDescendantById(tabId);
    _resolvedLocalPath = root?.findDescendantById('sftp-local-path') ?? null;
    _resolvedLocalList = root?.findDescendantById('sftp-local-list') ?? null;
    _resolvedRemotePath = root?.findDescendantById('sftp-remote-path') ?? null;
    _resolvedRemoteList = root?.findDescendantById('sftp-remote-list') ?? null;
    _resolvedStatus = root?.findDescendantById('sftp-status') ?? null;
    _resolvedLocalPanel = root?.findDescendantById('sftp-local-panel') ?? null;
    _resolvedRemotePanel = root?.findDescendantById('sftp-remote-panel') ?? null;
    _resolvedLocalScroll = root?.findDescendantById('sftp-local-scroll') ?? null;
    _resolvedRemoteScroll = root?.findDescendantById('sftp-remote-scroll') ?? null;
    // ScrollBox 默认可聚焦；文件列表的按键由本组件统一处理，别让它抢焦点
    if (_resolvedLocalScroll) _resolvedLocalScroll.focusable = false;
    if (_resolvedRemoteScroll) _resolvedRemoteScroll.focusable = false;
  }

  // ── Render functions ──────────────────────────────────────────
  /** 让选中行保持在视口内（ScrollBox 自带滚动，只需按需 scrollTo）。 */
  function ensureIndexVisible(scroll: any, index: number): void {
    if (!scroll || scroll.isDestroyed) return;
    const viewport = Math.max(1, Math.floor(scroll.viewport?.height || scroll.height || 1));
    if (index < scroll.scrollTop) {
      scroll.scrollTo(index);
    } else if (index >= scroll.scrollTop + viewport) {
      scroll.scrollTo(index - viewport + 1);
    }
  }

  function renderListChrome(state: FileListState, pathText: any, panel: any, side: PanelSide): void {
    if (pathText) {
      pathText.content = ` ${side === 'local' ? 'Local' : 'Remote'}: ${state.currentPath}`;
    }
    if (panel) {
      panel.borderColor = side === activeSide ? C.borderActive : C.border;
    }
  }

  /** Build one column of rendered lines; also used to refresh a single chunk. */
  function buildListChunk(state: FileListState, start: number, end: number): StyledText {
    const chunks: TextChunk[] = [];
    const selectedFg = toRGBA(C.bg);
    const selectedBg = toRGBA(C.textDim);
    const normalFg = toRGBA(C.textDim);

    for (let i = start; i < end; i++) {
      const item = state.items[i];
      if (!item) continue;
      if (i > start) {
        chunks.push({ __isChunk: true, text: '\n', fg: normalFg, attributes: 0 });
      }

      const prefix = item.isDirectory ? '/' : ' ';
      const sizeStr = item.isDirectory ? '' : ` ${formatSize(item.size).padStart(8)}`;
      const timeStr = item.mtime ? ` ${formatTime(item.mtime)}` : '';
      const line = ` ${prefix}${item.name}${sizeStr}${timeStr} `;
      const isSelected = i === state.selectedIndex;

      chunks.push({
        __isChunk: true,
        text: line,
        fg: isSelected ? selectedFg : normalFg,
        ...(isSelected ? { bg: selectedBg } : {}),
        attributes: 0,
      });
    }

    return new StyledText(chunks);
  }

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

  // ── Data loading ──────────────────────────────────────────────
  let localLoadToken = 0;
  let remoteLoadToken = 0;
  let lastRefreshAt = 0;
  let refreshInFlight: Promise<void> | null = null;

  async function loadRemoteDir(path: string): Promise<void> {
    const token = ++remoteLoadToken;
    log.debug(`[SFTP LOAD REMOTE] path:${path}`);
    try {
      if (path === '~') {
        path = await sftpClient.realpath('.');
      } else if (path.startsWith('~/')) {
        const home = await sftpClient.realpath('.');
        path = home + path.slice(1);
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
      // Use node:path for correct Windows/Unix path joining
      const { join } = await import('node:path');
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
      // Use node:path for correct Windows/Unix path handling
      const { dirname } = await import('node:path');
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
    const state = activeSide === 'local' ? localState : remoteState;
    if (activeSide === 'local') return isAbsolute(p) ? p : resolve(state.currentPath, p);
    return resolveRemotePath(state.currentPath, p);
  }

  /** 取路径最后一段，用于提示文案 */
  function pathName(p: string): string {
    if (activeSide === 'local') return basename(p);
    return p.split('/').filter(Boolean).pop() ?? p;
  }

  /** 判断路径是否为目录；不依赖列表缓存，因此支持当前目录之外的路径 */
  async function isDirectoryPath(p: string): Promise<boolean> {
    if (activeSide === 'remote') {
      const attrs = await sftpClient.stat(p);
      return attrs.isDirectory();
    }
    const { stat } = await import('node:fs/promises');
    return (await stat(p)).isDirectory();
  }

  async function executeCommand(input: string): Promise<boolean> {
    const parts = input.trim().split(/\s+/);
    const cmd = parts[0];
    const args = parts.slice(1);
    let ok = true;

    log.debug(`[SFTP CMD] cmd:${cmd} args:${JSON.stringify(args)} activeSide:${activeSide}`);

    switch (cmd) {
      case 'upload': {
        // upload <source> [dest]
        if (args.length < 1) {
          renderStatus('Usage: upload <local_path> [remote_path]', C.red);
          return false;
        }
        const src = args[0];
        const localPath = isAbsolute(src) ? src : resolve(localState.currentPath, src);
        const fileBase = basename(src);
        const rawDest = args[1];
        const remotePath = !rawDest || rawDest === '.' || rawDest === './'
          ? resolveRemotePath(remoteState.currentPath, fileBase)
          : resolveRemotePath(remoteState.currentPath, rawDest);
        renderStatus(`Uploading ${localPath} → ${remotePath}...`, C.yellow);
        try {
          await sftpClient.upload(localPath, remotePath);
          renderStatus(`Uploaded: ${fileBase}`, C.green);
          await loadRemoteDir(remoteState.currentPath);
          return true;
        } catch (err) {
          const msg = err instanceof Error ? err.message : 'Upload failed';
          log.error(`[SFTP UPLOAD] ${localPath} → ${remotePath}: ${msg}`);
          renderStatus(`Upload failed: ${msg}`, C.red);
          return false;
        }
      }
      case 'download': {
        // download <source> [dest]
        if (args.length < 1) {
          renderStatus('Usage: download <remote_path> [local_path]', C.red);
          return false;
        }
        const src = args[0];
        const remotePath = resolveRemotePath(remoteState.currentPath, src);
        const fileBase = basename(src);
        const rawDest = args[1];
        const localPath = !rawDest || rawDest === '.' || rawDest === '.\\' || rawDest === './'
          ? resolve(localState.currentPath, fileBase)
          : (isAbsolute(rawDest) ? rawDest : resolve(localState.currentPath, rawDest));
        renderStatus(`Downloading ${remotePath} → ${localPath}...`, C.yellow);
        try {
          await sftpClient.download(remotePath, localPath);
          renderStatus(`Downloaded: ${fileBase}`, C.green);
          await loadLocalDir(localState.currentPath);
          return true;
        } catch (err) {
          const msg = err instanceof Error ? err.message : 'Download failed';
          log.error(`[SFTP DOWNLOAD] ${remotePath} → ${localPath}: ${msg}`);
          renderStatus(`Download failed: ${msg}`, C.red);
          return false;
        }
      }
      case 'mkdir': {
        if (args.length < 1) {
          renderStatus('Usage: mkdir <name>', C.red);
          return false;
        }
        const name = args[0];
        const state = activeSide === 'local' ? localState : remoteState;
        const fullPath = activeSide === 'local'
          ? join(state.currentPath, name)
          : resolveRemotePath(state.currentPath, name);
        try {
          if (activeSide === 'remote') {
            await sftpClient.mkdir(fullPath);
          } else {
            const { mkdir } = await import('node:fs/promises');
            await mkdir(fullPath);
          }
          renderStatus(`Created: ${name}`, C.green);
          if (activeSide === 'local') {
            await loadLocalDir(localState.currentPath);
          } else {
            await loadRemoteDir(remoteState.currentPath);
          }
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
          fullPath = toAbsPath(args[0]);
          name = pathName(fullPath);
        }
        try {
          const isDir = isDirHint ?? await isDirectoryPath(fullPath);
          if (activeSide === 'remote') {
            if (isDir) {
              await sftpClient.rmdir(fullPath);
            } else {
              await sftpClient.unlink(fullPath);
            }
          } else {
            const { unlink, rmdir } = await import('node:fs/promises');
            if (isDir) {
              await rmdir(fullPath);
            } else {
              await unlink(fullPath);
            }
          }
          renderStatus(`Deleted: ${name}`, C.green);
          if (activeSide === 'local') {
            await loadLocalDir(localState.currentPath);
          } else {
            await loadRemoteDir(remoteState.currentPath);
          }
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
        const oldPath = toAbsPath(args[0]);
        let newPath = toAbsPath(args[1]);
        // dst 是已存在的目录（或以分隔符结尾）→ 移入该目录，保留原文件名
        let dstIsDir = /[\\/]$/.test(args[1]);
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
        const sep = activeSide === 'local' ? (oldPath.includes(pathSep) ? pathSep : '/') : '/';
        if (newPath.startsWith(oldPath + sep)) {
          renderStatus('Cannot move a directory into itself', C.red);
          return false;
        }
        try {
          if (activeSide === 'remote') {
            await sftpClient.rename(oldPath, newPath);
          } else {
            const { rename } = await import('node:fs/promises');
            await rename(oldPath, newPath);
          }
          renderStatus(`Moved: ${pathName(oldPath)} → ${pathName(newPath)}`, C.green);
          if (activeSide === 'local') {
            await loadLocalDir(localState.currentPath);
          } else {
            await loadRemoteDir(remoteState.currentPath);
          }
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
        let targetPath = args[0];
        // Resolve relative path for remote side
        if (activeSide === 'remote' && !targetPath.startsWith('/')) {
          const sep = remoteState.currentPath.endsWith('/') ? '' : '/';
          targetPath = `${remoteState.currentPath}${sep}${targetPath}`;
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
      const matches = KNOWN_COMMANDS.filter(c => c.startsWith(currentToken));
      if (matches.length === 1) {
        parts[parts.length - 1] = matches[0];
        cmdBuffer = parts.join(' ') + ' ' + after;
        cmdCursorPos = cmdBuffer.length - after.length;
      } else if (matches.length > 1) {
        renderStatus(`Candidates: ${matches.join(', ')}`, C.cyan);
      }
    } else {
      // Complete file path
      const cmd = parts[0];
      const state = activeSide === 'local' ? localState : remoteState;
      const sep = activeSide === 'local' ? pathSep : '/';

      // Resolve directory and prefix from currentToken
      let dir = state.currentPath;
      let prefix = currentToken;
      const lastSep = Math.max(currentToken.lastIndexOf('/'), currentToken.lastIndexOf('\\'));
      if (lastSep >= 0) {
        const tokenDir = currentToken.slice(0, lastSep);
        prefix = currentToken.slice(lastSep + 1);
        if (activeSide === 'remote' && !tokenDir.startsWith('/')) {
          dir = resolveRemotePath(state.currentPath, tokenDir);
        } else if (activeSide === 'local') {
          const { join } = await import('node:path');
          dir = join(state.currentPath, tokenDir);
        } else {
          dir = tokenDir;
        }
      }

      // Get file list for completion
      let items: FileItem[] = [];
      try {
        if (activeSide === 'remote') {
          items = await sftpClient.readdir(dir);
        } else {
          const { readdir } = await import('node:fs/promises');
          const systemNames = await getWindowsSystemNames(dir);
          const entries = await readdir(dir, { withFileTypes: true });
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

      const matches = items.filter(i => i.name.startsWith(prefix));
      if (matches.length === 1) {
        const match = matches[0];
        const completedName = currentToken.slice(0, lastSep + 1) + match.name;
        const suffix = match.isDirectory ? sep : ' ';
        parts[parts.length - 1] = completedName + suffix;
        cmdBuffer = parts.join(' ') + after;
        cmdCursorPos = cmdBuffer.length - after.length;
      } else if (matches.length > 1) {
        // Complete common prefix
        let common = matches[0].name;
        for (const m of matches) {
          while (!m.name.startsWith(common)) {
            common = common.slice(0, -1);
          }
        }
        if (common.length > prefix.length) {
          const completedName = currentToken.slice(0, lastSep + 1) + common;
          parts[parts.length - 1] = completedName;
          cmdBuffer = parts.join(' ') + after;
          cmdCursorPos = cmdBuffer.length - after.length;
        }
        const dirMarker = matches.some(m => m.isDirectory) ? '/ ' : ' ';
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
      sftpCmdMode: cmdMode,
      formField: -1,
      activeTabType: 'sftp',
    };
    const binding = findBinding('sftp', k, ctx);
    log.debug(`[SFTP KEY] name:${k.name} ctrl:${k.ctrl} cmd:${cmdMode} binding:${binding?.id ?? '-'}`);

    switch (binding?.id) {
      // ── 命令行模式 ────────────────────────────────────────────
      case 'sftp.cmd.execute': {
        const cmd = cmdBuffer.trim();
        cmdBuffer = '';
        cmdCursorPos = 0;
        if (cmd) {
          cmdHistory.push(cmd);
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

    getSelectedFilePath(): string | null {
      const state = activeSide === 'local' ? localState : remoteState;
      const item = state.items[state.selectedIndex];
      if (!item) return null;
      return activeSide === 'local'
        ? join(state.currentPath, item.name)
        : resolveRemotePath(state.currentPath, item.name);
    },

    isCommandMode(): boolean {
      return cmdMode;
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
