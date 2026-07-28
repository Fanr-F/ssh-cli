# AGENTS.MD

## Project Overview

**ssh-cli** is a keyboard-driven terminal-based SSH client with an interactive TUI. It manages SSH connections, authenticates with key or password, and provides a live remote shell with vterm.js terminal emulation.

- **Runtime**: Bun
- **UI Framework**: OpenTUI (@opentui/core)
- **Terminal Emulation**: vterm.js (via vterm-adapter.ts)
- **SSH Library**: ssh2-no-cpu-features
- **Language**: TypeScript (strict mode)
- **Documentation**: [English](README.md) | [中文](README.zh.md)

## Project Structure

```
src/
├── index.ts              # Entry point - creates renderer with { exitOnCtrlC: false, useMouse: true }
├── app.ts                # Main application class - layout, focus management, keyboard routing, multi-tab
├── logger.ts             # Logging system (LogTape, writes to ssh-cli.log)
├── clipboard.ts          # Copy/paste operations
├── ssh/                  # SSH connection layer
│   ├── auth.ts           # Authentication config builder (key/password)
│   ├── connection.ts     # SSH session lifecycle (SshConnection class) + startSftp()
│   └── types.ts          # SSH types (SshConnectionState, errors)
├── sftp/                 # SFTP file manager module
│   ├── sftp-client.ts    # SFTP client wrapper (readdir, mkdir, upload, download, etc.)
│   ├── sftp-tab.ts       # SFTP dual-panel tab (cmd mode, keyboard, scrollY scrolling)
│   ├── sftp-input-dialog.ts # Path input dialog (used by Ctrl+U/D in terminal mode)
│   └── types.ts          # SFTP types (FileEntry, TransferTask, PanelSide)
├── storage/              # Persistence layer (plain JSON, NO encryption)
│   ├── config.ts         # Config file paths (~/.ssh-cli/)
│   └── connections.ts    # ConnectionStore CRUD
├── terminal/             # Terminal emulation engine
│   ├── vterm-adapter.ts  # vterm.js wrapper with scrollback buffer
│   └── terminal-renderer.ts # OpenTUI render bridge (dirty-diff rendering)
├── types/                # Shared TypeScript interfaces
│   ├── connection.ts     # ConnectionConfig interface
│   └── terminal.ts       # Cell, CursorPosition, ScreenBufferState
└── ui/                   # OpenTUI UI components
    ├── sidebar.ts        # Connection list sidebar (ScrollBox with mouse selection)
    ├── connection-form.ts # Add/edit connection modal form
    ├── status-bar.ts     # Status bar (fully disabled - no-op API)
    ├── terminal-panel.ts # Terminal display panel (with setVisible())
    ├── tab-bar.ts        # Multi-tab bar (F2-F12, Ctrl+Shift+Tab, type field: terminal|sftp)
    ├── toolbar.ts        # Clickable shortcut toolbar at top
    ├── divider.ts        # Draggable sidebar divider
    └── help-popup.ts     # Draggable help popup (F1) with SFTP shortcuts
```

## Key Patterns

### Focus Zones
The app uses a focus zone system: `sidebar`, `terminal`, `form`. Keyboard events are routed based on current focus. Use `Alt+←/→` to switch between sidebar and terminal.

### Keyboard Shortcuts
- **Ctrl+Q** — Quit application (NOT Ctrl+C)
- **Ctrl+C** — Copy (connection info in sidebar, selected text or last line in terminal)
- **Ctrl+V** — Paste (clipboard content to terminal/form)
- **Ctrl+Shift+C** — Close current tab
- **Ctrl+Shift+Tab** — Cycle to next tab
- **Alt+←/→** — Switch focus between sidebar and terminal
- **Alt+↑/↓** — Navigate connections (global)
- **F1** — Toggle help popup
- **F2-F12** — Switch to tab 1-11
- **PageUp/PageDown** — Scroll terminal output
- **Enter** — Connect to selected server (in sidebar)
- **a** — Add new connection
- **e** — Edit selected connection
- **Delete** — Delete selected connection
- **Esc** — Cancel/close form
- **↑/↓** — Navigate connection list (when sidebar focused)
- **Ctrl+E** — Open SFTP tab (terminal mode: opens dialog for path input; SFTP mode: no-op)

### Mouse Support
- Mouse support enabled via `useMouse: true` in index.ts renderer config
- **Sidebar items**: `onMouseDown` handles single-click (select) and double-click (connect)
- **Help popup**: `onMouseDrag` for dragging (no onMouseDown/onMouseUp needed)
- **Tab bar**: Double-click to close tab
- **Divider**: Drag to resize sidebar width
- **Toolbar buttons**: Clickable shortcuts

### OpenTUI Patterns

#### Resolving Renderable Instances
Box() returns a Proxy. To call methods like `add()`, `remove()`, or set properties on the actual renderable, resolve via `findDescendantById()`:
```typescript
let _instance: any = null;
function getInstance(): any {
  if (!_instance) {
    _instance = renderer.root.findDescendantById('element-id');
  }
  return _instance;
}
```

#### Setting Properties After Instantiation
Properties set after Box() creation must use the resolved instance:
```typescript
instance.visible = true;
instance.top = '20%';
instance.left = '25%';
renderer.requestRender();
```

#### Mouse Event Coordinates
OpenTUI mouse events (`e.x`, `e.y`) are **character cell coordinates**, NOT pixels. No conversion needed.

#### onMouseDrag Pattern
`onMouseDrag` fires continuously during drag. Track delta between events:
```typescript
let lastDragX = -1;
onMouseDrag: (e: MouseEvent) => {
  if (lastDragX === -1) { lastDragX = e.x; lastDragY = e.y; return; }
  const deltaX = e.x - lastDragX;
  const deltaY = e.y - lastDragY;
  lastDragX = e.x; lastDragY = e.y;
  // Update position using delta...
}
```

### Multi-Tab System
- Tabs stored in `Map<string, { vterm, renderer, ssh, config }>`
- Tab bar manages tab switching and closing
- Each tab has its own VtermAdapter and TerminalRenderer
- Active tab ID tracked via `tabBar.getActiveTabId()`

### SFTP File Manager
- **Dual-panel layout**: Local (left) / Remote (right)
- **Independent SSH connections**: Each SFTP tab creates its own SSH connection
- **Command line mode** (`:`): persistent mode, Enter executes but stays in mode, Esc exits
- **Commands**: `upload <local> <remote>`, `download <remote> <local>`, `mkdir <path>`, `rm <path>`, `rename <old> <new>`, `cd <path>`
- **ScrollY scrolling**: Uses `listText.scrollY` to sync keyboard navigation with file list
- **Remote cd resolution**: Relative paths resolved against `remoteState.currentPath`
- **Tab close independence**: Closing one tab doesn't affect others

### SSH State Machine
`SshConnectionState`: Disconnected → Connecting → Connected → Disconnected

## Commands

```bash
bun run start   # Run the application
```

No test suite, no linter, no formatter configured. TypeScript strict mode enforced via tsconfig.json.

## Code Conventions

- TypeScript strict mode
- Classes for stateful components (App, SshConnection, ConnectionStore)
- Factory functions for UI components (createSidebar, createTerminalPanel, etc.)
- EventEmitter for SSH connection events
- Async/await for initialization and SSH operations
- Tokyo Night color palette for UI theming

## Important Notes

- **Ctrl+C does NOT exit** — `exitOnCtrlC: false` in index.ts. Ctrl+C is forwarded to SSH shell when connected, copies text when terminal has selection.
- **ssh2-no-cpu-features** — Used over ssh2 because native cpu-features module fails on Bun.
- **vterm.js** — Full terminal emulation, NOT custom ANSI parser. Scrollback buffer managed in vterm-adapter.ts.
- **No encryption** — Storage is plain JSON (~/.ssh-cli/config.json). Master password dialog was removed.
- **Platform-specific OpenTUI** — `@opentui/core-win32-x64` is a separate dependency for Windows.
