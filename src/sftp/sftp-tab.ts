import { Box, Text, StyledText } from '@opentui/core';
import type { CliRenderer, KeyEvent } from '@opentui/core';
import { SftpClient } from './sftp-client';
import type { FileItem, PanelSide } from './types';
import { createLogger } from '../logger';
import { basename, isAbsolute, resolve } from 'node:path';

const log = createLogger('sftp-tab');

const KNOWN_COMMANDS = ['upload', 'download', 'mkdir', 'rm', 'rename', 'cd'];

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
  const headerBox = Box(
    { id: 'sftp-header', flexDirection: 'row', height: 1, backgroundColor: C.bg, paddingX: 1 },
    Text({ content: ' SFTP ', fg: C.blue }),
    Text({ content: '|', fg: C.border }),
    Text({ content: ' Tab:切换  Up/Down:选择  Enter:进入  Bksp:上级  ::命令行  Ctrl+U:上传  Ctrl+D:下载 ', fg: C.textDim }),
  );

  // Local panel
  const localPathText = Text({ content: ` Local: ${localState.currentPath}`, fg: C.cyan, id: 'sftp-local-path' });
  const localListText = Text({ content: ' Loading...', fg: C.textDim, id: 'sftp-local-list', wrapMode: 'none' });
  const localPanel = Box(
    { id: 'sftp-local-panel', flexDirection: 'column', flexGrow: 1, backgroundColor: C.surface, paddingX: 1 },
    localPathText,
    Text({ content: '', fg: C.border, width: '100%' }),
    localListText,
  );

  // Remote panel
  const remotePathText = Text({ content: ` Remote: ${remoteState.currentPath}`, fg: C.cyan, id: 'sftp-remote-path' });
  const remoteListText = Text({ content: ' Loading...', fg: C.textDim, id: 'sftp-remote-list', wrapMode: 'none' });
  const remotePanel = Box(
    { id: 'sftp-remote-panel', flexDirection: 'column', flexGrow: 1, backgroundColor: C.surface, paddingX: 1 },
    remotePathText,
    Text({ content: '', fg: C.border, width: '100%' }),
    remoteListText,
  );

  // Status bar
  const statusText = Text({ content: ' Ready', fg: C.textDim, id: 'sftp-status' });
  const statusBar = Box(
    { id: 'sftp-status-bar', flexDirection: 'row', height: 1, backgroundColor: C.statusBarBg, paddingX: 1 },
    statusText,
  );

  // Help line
  const helpLine = Text({
    content: ' :命令  upload download mkdir rm rename cd',
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
    log.debug(`[SFTP RESOLVE] root:${!!root} localPath:${!!_resolvedLocalPath} localList:${!!_resolvedLocalList} remotePath:${!!_resolvedRemotePath} remoteList:${!!_resolvedRemoteList} status:${!!_resolvedStatus} localPanel:${!!_resolvedLocalPanel} remotePanel:${!!_resolvedRemotePanel}`);
  }

  // ── Render functions ──────────────────────────────────────────
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
      const chunks: any[] = [];

      for (let i = 0; i < state.items.length; i++) {
        const item = state.items[i];
        const isSelected = i === state.selectedIndex;
        const prefix = item.isDirectory ? '/' : ' ';
        const sizeStr = item.isDirectory ? '' : ` ${formatSize(item.size).padStart(8)}`;
        const timeStr = item.mtime ? ` ${formatTime(item.mtime)}` : '';
        const name = `${prefix}${item.name}`;
        const line = ` ${name}${sizeStr}${timeStr} `;

        if (isSelected) {
          chunks.push({ __isChunk: true, text: line, fg: C.bg, bg: C.textDim, attributes: 0 });
        } else {
          chunks.push({ __isChunk: true, text: line, fg: C.textDim, attributes: 0 });
        }

        if (i < state.items.length - 1) {
          chunks.push({ __isChunk: true, text: '\n', fg: C.textDim, attributes: 0 });
        }
      }

      listText.content = new StyledText(chunks);
    }
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

  // ── Simple input helper ────────────────────────────────────────
  let inputResolve: ((value: string) => void) | null = null;
  let inputBuffer = '';

  function waitForInput(initialValue: string = ''): Promise<string> {
    return new Promise((resolve) => {
      inputResolve = resolve;
      inputBuffer = initialValue;
      renderStatus(`Input: ${inputBuffer}_`);
      renderer.requestRender();
    });
  }

  // ── Command mode ──────────────────────────────────────────────
  function enterCommandMode(initial: string = ''): void {
    cmdMode = true;
    cmdBuffer = initial;
    cmdCursorPos = initial.length;
    renderStatus(`> ${cmdBuffer}_`);
    renderer.requestRender();
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
        if (args.length < 1) {
          renderStatus('Usage: rm <name>', C.red);
          return false;
        }
        const name = args[0];
        const state = activeSide === 'local' ? localState : remoteState;
        const item = state.items.find(i => i.name === name);
        if (!item) {
          renderStatus(`Not found: ${name}`, C.red);
          return false;
        }
        const sep = activeSide === 'local' ? (getHomeDir().includes('\\') ? '\\' : '/') : '/';
        const fullPath = `${state.currentPath}${state.currentPath.endsWith(sep) ? '' : sep}${name}`;
        try {
          if (activeSide === 'remote') {
            if (item.isDirectory) {
              await sftpClient.rmdir(fullPath);
            } else {
              await sftpClient.unlink(fullPath);
            }
          } else {
            const { unlink, rmdir } = await import('node:fs/promises');
            if (item.isDirectory) {
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
          renderStatus(`Delete failed: ${msg}`, C.red);
          ok = false;
        }
        break;
      }
      case 'rename': {
        if (args.length < 2) {
          renderStatus('Usage: rename <old> <new>', C.red);
          return false;
        }
        const oldName = args[0];
        const newName = args[1];
        const state = activeSide === 'local' ? localState : remoteState;
        const sep = activeSide === 'local' ? (getHomeDir().includes('\\') ? '\\' : '/') : '/';
        const oldPath = `${state.currentPath}${state.currentPath.endsWith(sep) ? '' : sep}${oldName}`;
        const newPath = `${state.currentPath}${state.currentPath.endsWith(sep) ? '' : sep}${newName}`;
        try {
          if (activeSide === 'remote') {
            await sftpClient.rename(oldPath, newPath);
          } else {
            const { rename } = await import('node:fs/promises');
            await rename(oldPath, newPath);
          }
          renderStatus(`Renamed: ${oldName} → ${newName}`, C.green);
          if (activeSide === 'local') {
            await loadLocalDir(localState.currentPath);
          } else {
            await loadRemoteDir(remoteState.currentPath);
          }
        } catch (err) {
          const msg = err instanceof Error ? err.message : 'Rename failed';
          log.error(`[SFTP RENAME] ${oldPath} → ${newPath}: ${msg}`);
          renderStatus(`Rename failed: ${msg}`, C.red);
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
      default:
        renderStatus(`Unknown command: ${cmd} (type help for commands)`, C.red);
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
    } else if (inputResolve) {
      inputBuffer += text;
      renderStatus(`Input: ${inputBuffer}_`);
      renderer.requestRender();
    }
  }

  // ── Keyboard handling ─────────────────────────────────────────
  async function handleKey(key: KeyEvent): Promise<void> {
    log.debug(`[SFTP KEY] name:${key.name} ctrl:${key.ctrl} shift:${key.shift} destroyed:${destroyed} inputResolve:${!!inputResolve}`);
    if (destroyed) return;

    // If we're waiting for input, handle that first
    if (inputResolve) {
      if (key.name === 'enter' || key.name === 'return') {
        const value = inputBuffer;
        inputResolve(value);
        inputResolve = null;
        inputBuffer = '';
        return;
      }
      if (key.name === 'backspace') {
        inputBuffer = inputBuffer.slice(0, -1);
        renderStatus(`Input: ${inputBuffer}_`);
        renderer.requestRender();
        return;
      }
      if (key.name === 'escape') {
        inputResolve('');
        inputResolve = null;
        inputBuffer = '';
        renderStatus('Cancelled');
        return;
      }
      if (key.sequence && !key.ctrl && !key.alt && !key.meta) {
        inputBuffer += key.sequence;
        renderStatus(`Input: ${inputBuffer}_`);
        renderer.requestRender();
      }
      return;
    }

    // If we're in command mode, handle that
    if (cmdMode) {
      if (key.name === 'enter' || key.name === 'return') {
        const cmd = cmdBuffer.trim();
        cmdBuffer = '';
        cmdCursorPos = 0;
        let ok = true;
        if (cmd) {
          cmdHistory.push(cmd);
          cmdHistoryIdx = cmdHistory.length;
          ok = await executeCommand(cmd);
        }
        if (ok) {
          renderStatus('> ');
          renderer.requestRender();
        }
        return;
      }
      if (key.name === 'escape') {
        cmdMode = false;
        cmdBuffer = '';
        cmdCursorPos = 0;
        renderStatus('Ready');
        return;
      }
      if (key.name === 'backspace') {
        if (cmdCursorPos > 0) {
          cmdBuffer = cmdBuffer.slice(0, cmdCursorPos - 1) + cmdBuffer.slice(cmdCursorPos);
          cmdCursorPos--;
          renderStatus(`> ${cmdBuffer}_`);
          renderer.requestRender();
        }
        return;
      }
      if (key.name === 'up') {
        if (cmdHistoryIdx > 0) {
          cmdHistoryIdx--;
          cmdBuffer = cmdHistory[cmdHistoryIdx];
          cmdCursorPos = cmdBuffer.length;
          renderStatus(`> ${cmdBuffer}_`);
          renderer.requestRender();
        }
        return;
      }
      if (key.name === 'down') {
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
      }
      if (key.name === 'left') {
        if (cmdCursorPos > 0) {
          cmdCursorPos--;
          renderer.requestRender();
        }
        return;
      }
      if (key.name === 'right') {
        if (cmdCursorPos < cmdBuffer.length) {
          cmdCursorPos++;
          renderer.requestRender();
        }
        return;
      }
      if (key.name === 'home') {
        cmdCursorPos = 0;
        renderer.requestRender();
        return;
      }
      if (key.name === 'end') {
        cmdCursorPos = cmdBuffer.length;
        renderer.requestRender();
        return;
      }
      // Tab — autocompletion
      if (key.name === 'tab') {
        await handleCommandTabCompletion();
        return;
      }
      // Regular character input
      if (key.sequence && !key.ctrl && !key.alt && !key.meta) {
        cmdBuffer = cmdBuffer.slice(0, cmdCursorPos) + key.sequence + cmdBuffer.slice(cmdCursorPos);
        cmdCursorPos += key.sequence.length;
        renderStatus(`> ${cmdBuffer}_`);
        renderer.requestRender();
      }
      return;
    }

    // Tab — switch panel
    if (key.name === 'tab') {
      activeSide = activeSide === 'local' ? 'remote' : 'local';
      resolveAll();
      renderFileList(localState, _resolvedLocalList, _resolvedLocalPath, _resolvedLocalPanel, 'local');
      renderFileList(remoteState, _resolvedRemoteList, _resolvedRemotePath, _resolvedRemotePanel, 'remote');
      renderStatus(`Panel: ${activeSide === 'local' ? 'Local' : 'Remote'}`);
      renderer.requestRender();
      return;
    }

    const state = activeSide === 'local' ? localState : remoteState;
    const listText = activeSide === 'local' ? _resolvedLocalList : _resolvedRemoteList;

    // Up/Down — navigate
    if (key.name === 'up') {
      if (state.selectedIndex > 0) {
        state.selectedIndex--;
        if (listText && state.selectedIndex < listText.scrollY) {
          listText.scrollY = state.selectedIndex;
        }
      }
      resolveAll();
      renderFileList(state, activeSide === 'local' ? _resolvedLocalList : _resolvedRemoteList,
        activeSide === 'local' ? _resolvedLocalPath : _resolvedRemotePath,
        activeSide === 'local' ? _resolvedLocalPanel : _resolvedRemotePanel, activeSide);
      renderer.requestRender();
      return;
    }
    if (key.name === 'down') {
      if (state.selectedIndex < state.items.length - 1) {
        state.selectedIndex++;
        if (listText) {
          const h = listText.height || 1;
          if (state.selectedIndex >= listText.scrollY + h) {
            listText.scrollY = state.selectedIndex - h + 1;
          }
        }
      }
      resolveAll();
      renderFileList(state, activeSide === 'local' ? _resolvedLocalList : _resolvedRemoteList,
        activeSide === 'local' ? _resolvedLocalPath : _resolvedRemotePath,
        activeSide === 'local' ? _resolvedLocalPanel : _resolvedRemotePanel, activeSide);
      renderer.requestRender();
      return;
    }

    // Enter — enter directory
    if (key.name === 'enter' || key.name === 'return') {
      await enterDirectory(activeSide);
      return;
    }

    // Backspace — go up
    if (key.name === 'backspace') {
      await goUp(activeSide);
      return;
    }

    // : — enter command mode
    if (key.name === ':' && !key.ctrl && !key.shift) {
      enterCommandMode();
      return;
    }

    // Ctrl+U — pre-fill upload command
    if (key.ctrl && key.name === 'u') {
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

    // Ctrl+D — pre-fill download command
    if (key.ctrl && key.name === 'd') {
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

    // Ctrl+H — toggle showing Windows system-protected files
    if (key.ctrl && key.name === 'h') {
      showSystemFiles = !showSystemFiles;
      renderStatus(showSystemFiles ? 'Show system files (Ctrl+H to hide)' : 'Hide system files (Ctrl+H to show)', C.yellow);
      await loadLocalDir(localState.currentPath);
      return;
    }

    // R or Ctrl+R — refresh
    if (key.name === 'r' || (key.ctrl && key.name === 'r')) {
      renderStatus('Refreshing...');
      await loadLocalDir(localState.currentPath);
      await loadRemoteDir(remoteState.currentPath);
      renderStatus('Refreshed', C.green);
      return;
    }

    // F7 or n — new directory (remote only)
    if (key.name === 'f7' || (key.name === 'n' && !key.ctrl)) {
      if (activeSide === 'remote') {
        // Prompt for directory name via status bar
        renderStatus('Enter directory name, then press Enter:', C.yellow);
        // Simple input: wait for next key as directory name
        const inputName = await waitForInput();
        if (inputName) {
          const newPath = `${remoteState.currentPath}/${inputName}`;
          try {
            await sftpClient.mkdir(newPath);
            renderStatus(`Created directory: ${inputName}`, C.green);
            await loadRemoteDir(remoteState.currentPath);
          } catch (err) {
            const msg = err instanceof Error ? err.message : 'Mkdir failed';
            renderStatus(`Mkdir failed: ${msg}`, C.red);
          }
        }
      }
      return;
    }

    // F8 or Delete — delete file/directory
    if (key.name === 'f8' || key.name === 'delete') {
      const state = activeSide === 'local' ? localState : remoteState;
      const item = state.items[state.selectedIndex];
      if (item) {
        const sep = activeSide === 'local' ? (getHomeDir().includes('\\') ? '\\' : '/') : '/';
        const fullPath = `${state.currentPath}${state.currentPath.endsWith(sep) ? '' : sep}${item.name}`;
        renderStatus(`Delete ${item.name}? (y/n)`, C.yellow);
        const confirm = await waitForInput();
        if (confirm === 'y' || confirm === 'Y') {
          try {
            if (activeSide === 'remote') {
              if (item.isDirectory) {
                await sftpClient.rmdir(fullPath);
              } else {
                await sftpClient.unlink(fullPath);
              }
            } else {
              const { unlink, rmdir } = await import('node:fs/promises');
              if (item.isDirectory) {
                await rmdir(fullPath);
              } else {
                await unlink(fullPath);
              }
            }
            renderStatus(`Deleted: ${item.name}`, C.green);
            if (activeSide === 'local') {
              await loadLocalDir(localState.currentPath);
            } else {
              await loadRemoteDir(remoteState.currentPath);
            }
          } catch (err) {
            const msg = err instanceof Error ? err.message : 'Delete failed';
            renderStatus(`Delete failed: ${msg}`, C.red);
          }
        } else {
          renderStatus('Cancelled');
        }
      }
      return;
    }

    // F2 — rename
    if (key.name === 'f2') {
      const state = activeSide === 'local' ? localState : remoteState;
      const item = state.items[state.selectedIndex];
      if (item) {
        renderStatus(`Rename ${item.name} to:`, C.yellow);
        const newName = await waitForInput();
        if (newName && newName !== item.name) {
          const sep = activeSide === 'local' ? (getHomeDir().includes('\\') ? '\\' : '/') : '/';
          const oldPath = `${state.currentPath}${state.currentPath.endsWith(sep) ? '' : sep}${item.name}`;
          const newPath = `${state.currentPath}${state.currentPath.endsWith(sep) ? '' : sep}${newName}`;
          try {
            if (activeSide === 'remote') {
              await sftpClient.rename(oldPath, newPath);
            } else {
              const { rename } = await import('node:fs/promises');
              await rename(oldPath, newPath);
            }
            renderStatus(`Renamed to: ${newName}`, C.green);
            if (activeSide === 'local') {
              await loadLocalDir(localState.currentPath);
            } else {
              await loadRemoteDir(remoteState.currentPath);
            }
          } catch (err) {
            const msg = err instanceof Error ? err.message : 'Rename failed';
            renderStatus(`Rename failed: ${msg}`, C.red);
          }
        } else {
          renderStatus('Cancelled');
        }
      }
      return;
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
      await loadLocalDir(localState.currentPath);
      await loadRemoteDir(remoteState.currentPath);
    },
  };
}
