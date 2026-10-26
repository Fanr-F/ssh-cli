import { Box, ScrollBox, Text, StyledText, type TextChunk } from '@opentui/core';
import type { CliRenderer, KeyEvent } from '@opentui/core';
import { SftpClient } from './sftp-client';
import type { FileItem, PanelSide } from './types';
import { createLogger } from '../logger';
import { toRGBA } from '../color';
import { findBinding, normalizeKey, type KeyContext } from '../keymap';
import { basename, isAbsolute, join, resolve } from 'node:path';

const log = createLogger('sftp-tab');

const KNOWN_COMMANDS = ['upload', 'download', 'mkdir', 'rm', 'mv', 'cd', 'refresh', 'hidden'];

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

/** Get the user's home directory. */
function getHomeDir(): string {
  return process.env.HOME || process.env.USERPROFILE || '/';
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
  try {
    const { execFile } = await import('node:child_process');
    const output = await new Promise<string>((resolve, reject) => {
      execFile('attrib', [`${dir}\\*`], { windowsHide: true }, (err, stdout) => {
        if (err) reject(err);
        else resolve(stdout);
      });
    });
    const { basename } = await import('node:path');
    for (const line of output.split(/\r?\n/)) {
      const sep = line.indexOf(':');
      if (sep < 0) continue;
      const flags = line.slice(0, sep);
      if (flags.includes('S')) {
        names.add(basename(line.slice(sep - 1)));
      }
    }
  } catch {
    // attrib unavailable — fall back to showing everything
  }
  return names;
}

/** Read local directory contents. */
async function readLocalDir(path: string, hideSystem = true): Promise<FileItem[]> {
  const { readdir, stat } = await import('node:fs/promises');
  const { join } = await import('node:path');

  const entries = await readdir(path, { withFileTypes: true });
  const systemNames = hideSystem ? await getWindowsSystemNames(path) : new Set<string>();
  const items: FileItem[] = [];

  for (const entry of entries) {
    if (entry.name === '.' || entry.name === '..') continue;
    if (systemNames.has(entry.name)) continue;
    try {
      const fullPath = join(path, entry.name);
      const stats = await stat(fullPath);
      items.push({
        name: entry.name,
        isDirectory: entry.isDirectory(),
        isFile: entry.isFile(),
        isSymlink: entry.isSymbolicLink(),
        size: stats.size,
        mode: stats.mode,
        mtime: Math.floor(stats.mtimeMs / 1000),
        longname: '',
      });
    } catch {
      // Skip files we can't stat
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
  function createListScrollBox(id: string, list: ReturnType<typeof Text>) {
    return ScrollBox(
      {
        id,
        width: '100%',
        flexGrow: 1,
        flexBasis: 0,
        scrollY: true,
        scrollX: false,
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
  const localListText = Text({ content: ' Loading...', fg: C.textDim, id: 'sftp-local-list', wrapMode: 'none', width: '100%' });
  const localScroll = createListScrollBox('sftp-local-scroll', localListText);
  const localPanel = Box(
    { id: 'sftp-local-panel', flexDirection: 'column', flexGrow: 1, flexBasis: 0, backgroundColor: C.surface, paddingX: 1 },
    localPathText,
    Text({ content: '', fg: C.border, width: '100%' }),
    localScroll,
  );

  // Remote panel
  const remotePathText = Text({ content: ` Remote: ${remoteState.currentPath}`, fg: C.cyan, id: 'sftp-remote-path' });
  const remoteListText = Text({ content: ' Loading...', fg: C.textDim, id: 'sftp-remote-list', wrapMode: 'none', width: '100%' });
  const remoteScroll = createListScrollBox('sftp-remote-scroll', remoteListText);
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
  const mainBox = Box(
    { id: tabId, flexDirection: 'column', width: '100%', flexGrow: 1 },
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

  function resolveAll(): void {
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
    log.debug(`[SFTP RESOLVE] root:${!!root} localPath:${!!_resolvedLocalPath} localList:${!!_resolvedLocalList} remotePath:${!!_resolvedRemotePath} remoteList:${!!_resolvedRemoteList} status:${!!_resolvedStatus} localPanel:${!!_resolvedLocalPanel} remotePanel:${!!_resolvedRemotePanel}`);
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

  function renderFileList(state: FileListState, listText: any, pathText: any, panel: any, side: PanelSide): void {
    log.debug(`[SFTP RENDER] side:${side} listText:${!!listText} pathText:${!!pathText} panel:${!!panel} items:${state.items.length}`);
    if (!listText || !pathText) {
      log.debug(`[SFTP RENDER] early return - missing elements`);
      return;
    }

    // Update path
    pathText.content = ` ${side === 'local' ? 'Local' : 'Remote'}: ${state.currentPath}`;

    // Update border highlight
    const isActive = side === activeSide;
    if (panel) {
      panel.borderColor = isActive ? C.borderActive : C.border;
    }

    // Build file list — render ALL items, Text element handles viewport scrolling
    if (state.items.length === 0) {
      listText.content = ' (empty)';
      listText.fg = C.textDim;
    } else {
      const chunks: TextChunk[] = [];
      const selectedFg = toRGBA(C.bg);
      const selectedBg = toRGBA(C.textDim);
      const normalFg = toRGBA(C.textDim);

      for (let i = 0; i < state.items.length; i++) {
        const item = state.items[i];
        const isSelected = i === state.selectedIndex;
        const prefix = item.isDirectory ? '/' : ' ';
        const sizeStr = item.isDirectory ? '' : ` ${formatSize(item.size).padStart(8)}`;
        const timeStr = item.mtime ? ` ${formatTime(item.mtime)}` : '';
        const name = `${prefix}${item.name}`;
        const line = ` ${name}${sizeStr}${timeStr} `;

        if (isSelected) {
          chunks.push({ __isChunk: true, text: line, fg: selectedFg, bg: selectedBg, attributes: 0 });
        } else {
          chunks.push({ __isChunk: true, text: line, fg: normalFg, attributes: 0 });
        }

        if (i < state.items.length - 1) {
          chunks.push({ __isChunk: true, text: '\n', fg: normalFg, attributes: 0 });
        }
      }

      listText.content = new StyledText(chunks);
    }

    ensureIndexVisible(
      side === 'local' ? _resolvedLocalScroll : _resolvedRemoteScroll,
      state.selectedIndex,
    );
  }

  function renderStatus(msg: string, fg?: string): void {
    if (_resolvedStatus) {
      _resolvedStatus.content = ` ${msg}`;
      _resolvedStatus.fg = fg || C.textDim;
    }
    renderer.requestRender();
  }

  // ── Data loading ──────────────────────────────────────────────
  async function loadRemoteDir(path: string): Promise<void> {
    log.debug(`[SFTP LOAD REMOTE] path:${path}`);
    try {
      if (path === '~') {
        path = await sftpClient.realpath('.');
      } else if (path.startsWith('~/')) {
        const home = await sftpClient.realpath('.');
        path = home + path.slice(1);
      }
      const items = await sftpClient.readdir(path);
      log.debug(`[SFTP LOAD REMOTE] items count:${items.length}`);
      remoteState.items = items;
      remoteState.currentPath = path;
      remoteState.selectedIndex = 0;
      resolveAll();
      log.debug(`[SFTP LOAD REMOTE] after resolveAll: remoteList=${!!_resolvedRemoteList} remotePath=${!!_resolvedRemotePath} remotePanel=${!!_resolvedRemotePanel}`);
      renderFileList(remoteState, _resolvedRemoteList, _resolvedRemotePath, _resolvedRemotePanel, 'remote');
      log.debug(`[SFTP LOAD REMOTE] renderFileList done, listText content length=${_resolvedRemoteList?.content?.length ?? 'null'}`);
      renderer.requestRender();
    } catch (err) {
      log.debug(`[SFTP LOAD REMOTE] error: ${err}`);
      const msg = err instanceof Error ? err.message : 'Failed to read remote directory';
      renderStatus(`Error: ${msg}`, C.red);
    }
  }

  async function loadLocalDir(path: string): Promise<void> {
    try {
      // Resolve relative paths against current panel directory
      const { resolve, isAbsolute } = await import('node:path');
      const actualPath = isAbsolute(path) ? path : resolve(localState.currentPath, path);
      
      log.debug(`[SFTP LOAD LOCAL] input:${path} resolved:${actualPath}`);
      const items = await readLocalDir(actualPath, !showSystemFiles);
      localState.items = items;
      localState.currentPath = actualPath;
      localState.selectedIndex = 0;
      resolveAll();
      renderFileList(localState, _resolvedLocalList, _resolvedLocalPath, _resolvedLocalPanel, 'local');
      renderer.requestRender();
    } catch (err) {
      log.debug(`[SFTP LOAD LOCAL] error: ${err}`);
      const msg = err instanceof Error ? err.message : 'Failed to read local directory';
      renderStatus(`Error: ${msg}`, C.red);
    }
  }

  /** 刷新两个面板；verbose=false 用于切标签页时的静默刷新 */
  async function refreshBoth(verbose = true): Promise<void> {
    if (verbose) renderStatus('Refreshing...');
    await loadLocalDir(localState.currentPath);
    await loadRemoteDir(remoteState.currentPath);
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
      // Remote is always Unix-style paths
      const parts = state.currentPath.split('/').filter(Boolean);
      if (parts.length <= 1) return;
      parts.pop();
      const newPath = '/' + parts.join('/');
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
    return p.startsWith('/') ? p : `${state.currentPath.replace(/\/+$/, '')}/${p}`;
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
          ? `${remoteState.currentPath}/${fileBase}`
          : (rawDest.startsWith('/') ? rawDest : `${remoteState.currentPath}/${rawDest}`);
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
        const remotePath = src.startsWith('/') ? src : `${remoteState.currentPath}/${src}`;
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
        const sep = activeSide === 'local' ? (getHomeDir().includes('\\') ? '\\' : '/') : '/';
        const fullPath = `${state.currentPath}${state.currentPath.endsWith(sep) ? '' : sep}${name}`;
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
            : `${newPath.replace(/\/+$/, '')}/${pathName(oldPath)}`;
        }
        if (oldPath === newPath) {
          renderStatus('Source and destination are the same', C.red);
          return false;
        }
        const sep = activeSide === 'local' ? (oldPath.includes('\\') ? '\\' : '/') : '/';
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
      const sep = activeSide === 'local' ? (getHomeDir().includes('\\') ? '\\' : '/') : '/';

      // Resolve directory and prefix from currentToken
      let dir = state.currentPath;
      let prefix = currentToken;
      const lastSep = Math.max(currentToken.lastIndexOf('/'), currentToken.lastIndexOf('\\'));
      if (lastSep >= 0) {
        const tokenDir = currentToken.slice(0, lastSep);
        prefix = currentToken.slice(lastSep + 1);
        if (activeSide === 'remote' && !tokenDir.startsWith('/')) {
          dir = `${state.currentPath}/${tokenDir}`;
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
    state.selectedIndex = next;
    resolveAll();
    renderFileList(
      state,
      activeSide === 'local' ? _resolvedLocalList : _resolvedRemoteList,
      activeSide === 'local' ? _resolvedLocalPath : _resolvedRemotePath,
      activeSide === 'local' ? _resolvedLocalPanel : _resolvedRemotePanel,
      activeSide,
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
        renderFileList(localState, _resolvedLocalList, _resolvedLocalPath, _resolvedLocalPanel, 'local');
        renderFileList(remoteState, _resolvedRemoteList, _resolvedRemotePath, _resolvedRemotePanel, 'remote');
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
          const localPath = `${localState.currentPath}/${item.name}`;
          const remotePath = `${remoteState.currentPath}/${item.name}`;
          enterCommandMode(`upload ${localPath} ${remotePath}`);
        } else {
          renderStatus('Select a file in Local panel first', C.yellow);
        }
        return;
      }
      case 'sftp.prefillDownload': {
        const item = remoteState.items[remoteState.selectedIndex];
        if (item && !item.isDirectory) {
          const remotePath = `${remoteState.currentPath}/${item.name}`;
          const localPath = `${localState.currentPath}/${item.name}`;
          enterCommandMode(`download ${remotePath} ${localPath}`);
        } else {
          renderStatus('Select a file in Remote panel first', C.yellow);
        }
        return;
      }
      // 剪贴板动作由 App 执行（需要 clipboard 后端），组件不处理
      case 'sftp.copy':
      case 'sftp.paste':
        return;
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
      const sep = activeSide === 'local' ? (getHomeDir().includes('\\') ? '\\' : '/') : '/';
      return `${state.currentPath}${state.currentPath.endsWith(sep) ? '' : sep}${item.name}`;
    },

    isCommandMode(): boolean {
      return cmdMode;
    },

    focus(): void {
      resolveAll();
      renderFileList(localState, _resolvedLocalList, _resolvedLocalPath, _resolvedLocalPanel, 'local');
      renderFileList(remoteState, _resolvedRemoteList, _resolvedRemotePath, _resolvedRemotePanel, 'remote');
      renderer.requestRender();
    },

    destroy(): void {
      destroyed = true;
      sftpClient.close();
    },

    async refresh(): Promise<void> {
      await refreshBoth(false);
    },
  };
}
