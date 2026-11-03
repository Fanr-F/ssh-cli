# 🔌 SSH CLI — OpenTUI SSH Client

[![Bun](https://img.shields.io/badge/Bun-1.x-000?logo=bun)](https://bun.sh)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.x-3178C6?logo=typescript)](https://www.typescriptlang.org/)

A terminal-based SSH client with an interactive TUI, built with [Bun](https://bun.sh) and [OpenTUI](https://github.com/xanderjohansen/opentui).

**[中文文档](README.zh.md)**

---

## Overview

**SSH CLI** is a keyboard-driven SSH client that runs entirely in your terminal. Manage connections, authenticate with key or password, interact with remote shells — all without leaving the command line.

### Features

- **Connection Manager** — Add, edit, delete connections via keyboard-driven sidebar UI
- **OS Credential Storage** — Connection metadata lives in `~/.ssh-cli/config.json`; passwords/passphrases are stored in the OS keychain
- **Host Key Pinning** — Trust on first use; a changed server key is rejected
- **Dual Auth** — Supports both private key (`~/.ssh/id_rsa`, etc.) and password authentication
- **Native Terminal Emulation** — Full VT emulation via OpenTUI's `EmbeddedTerminalRenderable` (Ghostty VT engine)
- **Multi-Tab Support** — Open multiple SSH sessions in tabs, switch between them
- **Keyboard Forwarding** — Type directly into the remote shell; window resize propagates PTY size
- **Terminal Scrollback** — Scroll up/down to view previous output
- **SFTP File Manager** — Dual-panel file browser with command line interface
- **Independent SFTP Connections** — Each SFTP tab creates its own SSH connection; this isolates SFTP failures but costs one extra authentication per tab
- **Mouse Support** — Click to select connections, double-click to connect, clickable toolbar buttons
- **Draggable UI** — Resize sidebar divider, drag help popup window
- **Help System** — Press F1 to view all keyboard shortcuts

> **Platform**: Windows x64 is the only supported target.

<!-- shortcuts:begin -->

### Keyboard Shortcuts

#### General

| Key | Action |
|---|---|
| `Ctrl+Q` | Quit application |
| `F1` | Show / hide help |
| `Alt+↑` | Previous tab |
| `Alt+↓` | Next tab |
| `F2-F12` | Switch to tab 1-11 |
| `Ctrl+E` | Open SFTP tab for active connection |
| `Alt+←` | Focus sidebar |
| `Alt+→` | Focus terminal |

#### Sidebar

| Key | Action |
|---|---|
| `↑` | Previous connection |
| `↓` | Next connection |
| `Enter` | Connect to selected server |
| `A` | Add new connection |
| `E` | Edit selected connection |
| `Delete` | Delete selected connection (asks for confirmation) |

#### Terminal

| Key | Action |
|---|---|
| `PageUp` | Scroll output up (or page the remote full-screen program) |
| `PageDown` | Scroll output down (or page the remote full-screen program) |

#### SFTP

| Key | Action |
|---|---|
| `PageUp` | Page up in the active panel |
| `PageDown` | Page down in the active panel |
| `Tab` | Switch panel (local ↔ remote) |
| `↑` | Select previous item |
| `↓` | Select next item |
| `Enter` | Enter directory |
| `Backspace` | Go to parent directory |
| `:` | Enter command mode |
| `Ctrl+U` | Pre-fill upload command for selected local file |
| `Ctrl+D` | Pre-fill download command for selected remote file |

#### SFTP Command Line

> Only active after pressing `:` to enter command mode.

| Key | Action |
|---|---|
| `Enter` | Execute command (stays in command mode) |
| `Esc` | Leave command mode |
| `↑` | Previous command in history |
| `↓` | Next command in history |
| `Backspace` | Delete character before cursor |
| `←` | Move cursor left |
| `→` | Move cursor right |
| `Home` | Move cursor to start |
| `End` | Move cursor to end |
| `Tab` | Autocomplete command or file path |

#### SFTP Commands

> Command mode is persistent — Enter executes but stays in the prompt, Esc exits. Paths may be quoted and support backslash escapes.

| Command | Description |
|---|---|
| `upload <src> [dest]` | Upload local file to remote |
| `download <src> [dest]` | Download remote file to local |
| `mkdir <name>` | Create directory on active panel |
| `rm [path]` | Delete selected item or given path |
| `mv <src> <dst>` | Move / rename on active panel |
| `cd <path>` | Change directory and refresh both panels |
| `refresh` | Refresh both panels |
| `hidden [on\|off]` | Show / hide Windows system files |

#### Form

| Key | Action |
|---|---|
| `Esc` | Cancel and close form |
| `Enter` | Save connection (or activate the focused button) |
| `Delete` | Delete connection (when the Delete button is focused) |
| `Tab` | Next field |
| `Shift+Tab` | Previous field |
| `↓` | Next field (same as Tab) |
| `↑` | Previous field (same as Shift+Tab) |
| `←` | Switch auth type to Key (on Auth row) |
| `→` | Switch auth type to Password (on Auth row) |

#### Confirmation

| Key | Action |
|---|---|
| `Esc` | Cancel the pending action |
| `Enter` | Activate the focused button (Cancel is focused by default) |
| `Tab / →` | Next button |
| `Shift+Tab / ←` | Previous button |

### Mouse Shortcuts

| Action | Description |
|---|---|
| Single-click (sidebar) | Select connection |
| Double-click (sidebar) | Connect to selected server |
| Drag to select (any text) | Copy the selection to the clipboard |
| Right-click (terminal / SFTP command line / form field) | Paste the clipboard |
| Toolbar buttons | new / edit / connect / delete / quit / help |
| Single-click (tab) | Switch to that tab |
| Double-click (tab) | Close tab |
| Drag divider | Resize sidebar |
| Drag help window | Move help popup |
| Click form field | Focus that field (click places the caret) |
| Hold eye icon | Reveal password |

<!-- shortcuts:end -->

### Project Status

All core layers are implemented and integrated.

| Layer | Status |
|---|---|
| Engine (SSH, VT, Renderer, Storage) | ✅ Complete |
| UI Components (Sidebar, Form, Terminal Panel, StatusBar, TabBar, HelpPopup) | ✅ Complete |
| Application Wiring (layout, keyboard routing, SSH lifecycle, multi-tab) | ✅ Complete |
| Mouse Support (selection, copy, drag) | ✅ Complete |
| Verification & QA | ✅ Complete |

### Known Issues

#### No keyboard shortcut to close a tab

**Behaviour**: Closing a tab is mouse-only for now — double-click the tab. The previous `Ctrl+Shift+C` binding was removed: legacy terminals (Windows Terminal, VS Code) encode `Ctrl+Shift+<letter>` as `Ctrl+<letter>`, so the Shift modifier never reaches the app, and those terminals also bind `Ctrl+Shift+C` to "Copy".

**Status**: A replacement key (`Alt+W` / `Ctrl+W` / `Shift+F4`) is still undecided. The `tab.close` action is kept in `src/app.ts`, so re-enabling it only needs a new row in `src/keymap/bindings.ts`.

**Workaround**: double-click the tab to close it.

### Architecture

```
src/
├── index.ts              # Entry point — creates renderer and initializes App
├── app.ts                # Main application class — layout, focus management, keyboard dispatch
├── theme.ts              # Tokyo Night palette + semantic colour tokens
├── color.ts              # Hex → RGBA conversion cache for StyledText chunks
├── logger.ts             # Logging system (LogTape, writes to ~/.ssh-cli/ssh-cli.log)
├── app/                  # Extracted application helpers
│   ├── clipboard.ts      #   Selection copy + paste target routing
│   ├── terminal-tab.ts   #   EmbeddedTerminalRenderable factory
│   └── tab-navigation.ts #   Pure next/previous/jump tab helpers
├── keymap/               # Keyboard shortcut definitions (single source of truth)
│   ├── bindings.ts       #   Every binding: scope, key, group, docs text
│   ├── matcher.ts        #   Key normalization + pattern matching
│   ├── types.ts          #   Scope / Binding / KeyContext types
│   └── index.ts          #   buildDocs() used by help popup and README generator
├── ssh/                  # SSH connection layer
│   ├── auth.ts           #   Authentication config builder (key/password)
│   ├── connection.ts     #   SSH session lifecycle (SshConnection class)
│   ├── known-hosts.ts    #   TOFU host-key pinning and fingerprint checks
│   └── types.ts          #   SSH types (SshConnectionState, errors)
├── sftp/                 # SFTP file manager module
│   ├── sftp-client.ts    #   SFTP client wrapper (readdir, mkdir, upload, download)
│   ├── sftp-tab.ts       #   SFTP dual-panel tab (cmd mode, chunked file list, ScrollBox)
│   ├── file-list.ts      #   Directory listing, formatting, 32-line chunk rendering
│   ├── command-parser.ts #   `:` command parsing, path resolution, completion
│   ├── paths.ts          #   Remote POSIX path helpers
│   └── types.ts          #   SFTP types (FileEntry, PanelSide)
├── storage/              # Persistence layer
│   ├── config.ts         #   Config paths, 0600/0700 permissions, atomic writes
│   ├── connections.ts    #   ConnectionStore CRUD + legacy credential migration
│   ├── credentials.ts    #   Bun.secrets wrapper (password / passphrase)
│   └── schema.ts         #   Config validation and secret stripping
├── terminal/             # (removed — VT emulation is native in @opentui/core)
├── types/                # Shared TypeScript interfaces
│   └── connection.ts     #   ConnectionConfig interface
└── ui/                   # OpenTUI UI components
    ├── sidebar.ts        #   Connection list sidebar
    ├── connection-form.ts #   Add/edit connection modal form
    ├── status-bar.ts     #   One-line status bar for operation results and errors
    ├── terminal-panel.ts #   Terminal display panel (with setVisible())
    ├── tab-bar.ts        #   Multi-tab bar (F2-F12, type: terminal|sftp)
    ├── toolbar.ts        #   Clickable shortcut toolbar
    ├── divider.ts        #   Draggable sidebar divider
    ├── form-model.ts     #   Add/edit form state, validation, config building
    ├── password-field.ts #   Hand-rendered masked password input
    └── help-popup.ts     #   Draggable help popup (F1) with SFTP shortcuts
```

### Getting Started

```bash
# Prerequisites: Install Bun
curl -fsSL https://bun.sh/install | bash

# Clone the repository
git clone <repo-url> && cd ssh-cli

# Install dependencies
bun install

# Run (default: info level logging to ~/.ssh-cli/ssh-cli.log)
bun start

# Typecheck and run tests
bun run typecheck
bun test

# Run with debug logging
bun run start -- --log-level debug

# Run with trace logging (most verbose)
bun run start -- --log-level trace

# Compile the standalone Windows executable (outputs to dist/)
bun run build:win       # Windows x64 → dist/ssh-cli.exe

# Regenerate the shortcut tables in README.md / README.zh.md
bun run docs
```

### Logging

All logs are written to `~/.ssh-cli/ssh-cli.log` with `0600` permissions. No console output (TUI safe).

When the log exceeds 2 MB, it is rotated to `ssh-cli.log.1` at runtime (one backup is kept). SSH I/O previews are opt-in: they require `--log-level debug` **and** `SSH_CLI_LOG_IO=1`, and common secret patterns are masked. On the default `info` level this path allocates nothing.

| Flag | Description |
|---|---|
| `--log-level trace` | Most verbose — all operations logged |
| `--log-level debug` | Debug messages and above |
| `--log-level info` | Info and above (default) |
| `--log-level warning` | Warnings and errors only |
| `--log-level error` | Errors only |
| `SSH_CLI_LOG_IO=1` | Include redacted SSH I/O previews at debug level |

Log format:
```
[2026-06-17T01:56:51.603Z] [DEBUG  ] [ssh-cli.terminal] GET_STYLED_LINES: rows=49, scrollback=0, viewportOffset=0
[2026-06-17T01:56:51.612Z] [INFO   ] [ssh-cli.ssh] Connecting to SSH server host=192.168.1.100
[2026-06-17T01:56:52.105Z] [ERROR  ] [ssh-cli.ssh] SSH connection error error=Connection refused
```

### Usage

#### 1. Connection List (Sidebar)
The left panel shows your saved connections. Use `↑`/`↓` to navigate.

```
┌─────────────────────┬──────────────────────────┐
│  Connections        │  Terminal                │
│                     │                          │
│  ➜ myserver        │  (connected/disconnected) │
│    web-prod         │                          │
│    db-server        │                          │
│    dev-box          │                          │
│                     │                          │
│  [a]dd [e]dit       │  Status: Disconnected    │
│  [del]ete Enter=connect                        │
└─────────────────────┴──────────────────────────┘
```

#### 2. Add a Connection
Press `a` to open the connection form. Fill in:

| Field | Description | Example |
|---|---|---|
| **Name** | A label for the connection | `My Server` |
| **Host** | Server hostname or IP | `192.168.1.100` |
| **Port** | SSH port (default 22) | `22` |
| **Username** | SSH login user | `root` |
| **Auth Type** | `key` (private key) or `password` | `key` |
| **Key Path** | (only for key auth) Path to private key | `~/.ssh/id_rsa` |
| **Password** | (only for password auth) Login password | — |

Press `Tab` to move between fields (the value is selected, so typing replaces it), `Enter` to save, `Esc` to cancel. Inside a field: `←/→` moves the caret, `Shift+←/→` selects, `Ctrl+A` selects the whole value. Clicking a field places the caret; drag over text to copy it, right-click to paste.

#### 3. Connect to a Server
Select a connection in the sidebar and press `Enter`. The terminal panel will show live output from the remote shell.

- Type commands directly into the terminal — they are forwarded to the remote server
- The terminal renders ANSI escape sequences (colors, cursor movement, etc.)
- Resize your terminal window — the PTY size is automatically updated
- `PageUp`/`PageDown` scroll the local scrollback at a prompt; when a full-screen program is running remotely (`vim`, `less`, `htop`, `mc`, `tmux`, …) they are forwarded to it instead — detected via the alternate-screen sequence `ESC[?1049h/l`, no configuration needed. `Shift+PageUp`/`Shift+PageDown` always scroll locally.
- Drag over text to copy it; right-click to paste. `Ctrl+C` is passed straight to the shell (`SIGINT`) and `Ctrl+V` is left to the remote program (`quoted-insert` in bash, visual block in vim)

#### 4. Multi-Tab Support
- Open multiple SSH sessions in separate tabs
- Switch tabs with `Alt+↑` / `Alt+↓`, or jump straight to tab 1-11 with `F2-F12` (`F11` is taken by the host terminal)
- Close a tab by double-clicking it (no keyboard shortcut yet)
- Each tab maintains its own terminal state and scrollback

#### 5. SFTP File Manager
Press `Ctrl+E` from a terminal tab to open the SFTP file manager:

- **Dual-panel layout**: Local files on the left, remote files on the right
- **Independent SSH connections**: Each SFTP tab creates its own SSH connection
- **Navigate**: Use `↑`/`↓` to select files, `Enter` to open directories, `Backspace` to go up
- **Switch panels**: Press `Tab` to switch between local and remote panels
- **Command line**: Press `:` to enter command mode, then type commands like `upload`, `download`, `cd`, `mkdir`, `rm`, `mv`, `refresh`, `hidden` (`Tab` autocompletes, `↑/↓` browse history, `Esc` exits)
- **Shortcuts**: `Ctrl+U` to pre-fill an upload command, `Ctrl+D` to pre-fill download — everything else (mkdir, rm, mv, refresh, hidden) goes through the command line
- **Close**: Press `Esc` in command mode to exit it, or double-click the tab to close it

#### 6. Disconnect / Switch Sessions
- Close the remote shell (type `exit` on the remote) to disconnect — the tab closes automatically
- Press `Alt+←/→` to switch focus between sidebar and terminal
- The terminal panel shows the connection state: **Connecting**, **Connected**, **Error**, or **Disconnected**

#### 7. Edit / Delete Connections
- Select a connection and press `e` to **edit** its details
- Select a connection and press `Delete` to **delete** it

#### 8. Help
Press `F1` to open the help popup. The popup is draggable — click and drag to reposition it.

#### 9. Exit
Press `Ctrl+Q` to quit the application.

### Dependencies

| Package | Purpose |
|---|---|
| [`@opentui/core`](https://github.com/xanderjohansen/opentui) | Terminal UI framework (Box, Text, renderer, input) |
| [`@opentui/core-win32-x64`](https://github.com/xanderjohansen/opentui) | Platform-specific OpenTUI binary for Windows x64 |
| [`ssh2-no-cpu-features`](https://github.com/JAForbes/ssh2-no-cpu-features) | SSH2 client (cpu-features-free fork) |
| [`@logtape/logtape`](https://github.com/dahlia/logtape) | Structured logging (zero deps, file output) |

### Key Design Decisions

- **No JSX** — OpenTUI uses an imperative VNode API (`BoxRenderable`, `TextRenderable`, etc.) for component construction
- **Imperative API** — All UI components are classes, not functional components; state is mutated directly and re-rendered on demand
- **`ssh2-no-cpu-features`** — Used over `ssh2` because native `cpu-features` module fails on Bun
- **Native VT** — Terminal emulation is OpenTUI's native `EmbeddedTerminalRenderable`, which handles ANSI parsing, keyboard encoding, selection, scrolling and scrollback
- **No manual redraw** — The native renderable owns its buffer, so there is no per-row dirty-diff code in this project
- **Dynamic import** — `ssh2-no-cpu-features` is imported via `await import()` because it ships ESM with top-level await
- **File-only logging** — All logs write to `~/.ssh-cli/ssh-cli.log` (no console output to preserve TUI integrity)
- **Keychain credentials** — Passwords/passphrases never go into `config.json`; legacy plaintext entries are migrated on first launch when the OS keychain is available
