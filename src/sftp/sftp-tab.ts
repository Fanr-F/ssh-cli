import { Box, Text, StyledText } from '@opentui/core';
import type { CliRenderer, KeyEvent } from '@opentui/core';
import { SftpClient } from './sftp-client';
import type { FileItem, PanelSide } from './types';
import { createLogger } from '../logger';

const log = createLogger('sftp-tab');

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
  handleKey(key: KeyEvent): void;
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

/** Read local directory contents. */
async function readLocalDir(path: string): Promise<FileItem[]> {
  const { readdir, stat } = await import('node:fs/promises');
  const { join } = await import('node:path');

  const entries = await readdir(path, { withFileTypes: true });
  const items: FileItem[] = [];

  for (const entry of entries) {
    if (entry.name === '.' || entry.name === '..') continue;
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
    { id: 'sftp-tab', flexDirection: 'column', width: '100%', flexGrow: 1 },
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
    _resolvedLocalPath = renderer.root.findDescendantById('sftp-local-path');
    _resolvedLocalList = renderer.root.findDescendantById('sftp-local-list');
    _resolvedRemotePath = renderer.root.findDescendantById('sftp-remote-path');
    _resolvedRemoteList = renderer.root.findDescendantById('sftp-remote-list');
    _resolvedStatus = renderer.root.findDescendantById('sftp-status');
    _resolvedLocalPanel = renderer.root.findDescendantById('sftp-local-panel');
    _resolvedRemotePanel = renderer.root.findDescendantById('sftp-remote-panel');
    log.debug(`[SFTP RESOLVE] localPath:${!!_resolvedLocalPath} localList:${!!_resolvedLocalList} remotePath:${!!_resolvedRemotePath} remoteList:${!!_resolvedRemoteList} status:${!!_resolvedStatus} localPanel:${!!_resolvedLocalPanel} remotePanel:${!!_resolvedRemotePanel}`);
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
      const items = await readLocalDir(actualPath);
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

  async function executeCommand(input: string): Promise<void> {
    const parts = input.trim().split(/\s+/);
    const cmd = parts[0];
    const args = parts.slice(1);

    log.debug(`[SFTP CMD] cmd:${cmd} args:${JSON.stringify(args)} activeSide:${activeSide}`);

    switch (cmd) {
      case 'upload': {
        // upload <source> [dest]
        if (args.length < 1) {
          renderStatus('Usage: upload <local_path> [remote_path]', C.red);
          return;
        }
        const localPath = args[0];
        const remotePath = args[1] || `${remoteState.currentPath}/${localPath.split(/[/\\]/).pop()}`;
        renderStatus(`Uploading ${localPath} → ${remotePath}...`, C.yellow);
        try {
          await sftpClient.upload(localPath, remotePath);
          renderStatus(`Uploaded: ${args[0].split(/[/\\]/).pop()}`, C.green);
          await loadRemoteDir(remoteState.currentPath);
        } catch (err) {
          const msg = err instanceof Error ? err.message : 'Upload failed';
          renderStatus(`Upload failed: ${msg}`, C.red);
        }
        break;
      }
      case 'download': {
        // download <source> [dest]
        if (args.length < 1) {
          renderStatus('Usage: download <remote_path> [local_path]', C.red);
          return;
        }
        const remotePath = args[0];
        const localPath = args[1] || `${localState.currentPath}/${remotePath.split('/').pop()}`;
        renderStatus(`Downloading ${remotePath} → ${localPath}...`, C.yellow);
        try {
          await sftpClient.download(remotePath, localPath);
          renderStatus(`Downloaded: ${remotePath.split('/').pop()}`, C.green);
          await loadLocalDir(localState.currentPath);
        } catch (err) {
          const msg = err instanceof Error ? err.message : 'Download failed';
          renderStatus(`Download failed: ${msg}`, C.red);
        }
        break;
      }
      case 'mkdir': {
        if (args.length < 1) {
          renderStatus('Usage: mkdir <name>', C.red);
          return;
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
          renderStatus(`Mkdir failed: ${msg}`, C.red);
        }
        break;
      }
      case 'rm': {
        if (args.length < 1) {
          renderStatus('Usage: rm <name>', C.red);
          return;
        }
        const name = args[0];
        const state = activeSide === 'local' ? localState : remoteState;
        const item = state.items.find(i => i.name === name);
        if (!item) {
          renderStatus(`Not found: ${name}`, C.red);
          return;
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
          renderStatus(`Delete failed: ${msg}`, C.red);
        }
        break;
      }
      case 'rename': {
        if (args.length < 2) {
          renderStatus('Usage: rename <old> <new>', C.red);
          return;
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
          renderStatus(`Rename failed: ${msg}`, C.red);
        }
        break;
      }
      case 'cd': {
        if (args.length < 1) {
          renderStatus('Usage: cd <path>', C.red);
          return;
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
          renderStatus(`cd failed: ${msg}`, C.red);
        }
        break;
      }
      default:
        renderStatus(`Unknown command: ${cmd} (type help for commands)`, C.red);
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
        if (cmd) {
          cmdHistory.push(cmd);
          cmdHistoryIdx = cmdHistory.length;
          await executeCommand(cmd);
        }
        renderStatus('> ');
        renderer.requestRender();
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

    handleKey,

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
