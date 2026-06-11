# AGENTS.MD

## Project Overview

**ssh-cli** is a keyboard-driven terminal-based SSH client with an interactive TUI. It manages SSH connections, authenticates with key or password, and provides a live remote shell with ANSI terminal emulation.

- **Runtime**: Bun
- **UI Framework**: OpenTUI (@opentui/core)
- **SSH Library**: ssh2-no-cpu-features
- **Language**: TypeScript

## Project Structure

```
src/
├── index.ts              # Entry point - creates renderer and initializes App
├── app.ts                # Main application class - layout, focus management, keyboard routing
├── ssh/                  # SSH connection layer
│   ├── auth.ts           # Authentication config builder (key/password)
│   ├── connection.ts     # SSH session lifecycle (SshConnection class)
│   └── types.ts          # SSH types (SshConnectionState, errors)
├── storage/              # Persistence layer
│   ├── config.ts         # Config file paths (~/.ssh-cli/)
│   ├── connections.ts    # ConnectionStore CRUD (plain JSON)
│   └── encryption.ts     # AES-256-GCM encrypt/decrypt
├── terminal/             # Terminal emulation engine
│   ├── ansi-processor.ts  # ANSI escape sequence parser
│   ├── cell.ts           # Cell model (char, fg/bg colors, attributes)
│   ├── screen-buffer.ts  # 2D grid buffer with cursor tracking
│   └── terminal-renderer.ts # OpenTUI render bridge (dirty-diff rendering)
├── types/                # Shared TypeScript interfaces
│   ├── connection.ts     # ConnectionConfig interface
│   └── terminal.ts       # Cell, CursorPosition, ScreenBufferState
└── ui/                   # OpenTUI UI components
    ├── sidebar.ts        # Connection list sidebar
    ├── connection-form.ts # Add/edit connection modal form
    ├── status-bar.ts     # Status bar (connected/disconnected/hints)
    ├── terminal-panel.ts # Terminal display panel
    └── toolbar.ts        # Clickable shortcut toolbar at top
```

## Key Patterns

### Focus Zones
The app uses a focus zone system: `sidebar`, `terminal`, `form`. Keyboard events are routed based on current focus.

### Keyboard Shortcuts
- **Ctrl+Q** — Quit application (NOT Ctrl+C)
- **Ctrl+C** — Copy (connection info in sidebar, last line in terminal)
- **Ctrl+V** — Paste (clipboard content to terminal/form)
- **Ctrl+Tab** — Toggle focus between sidebar and terminal
- **Enter** — Connect to selected server (in sidebar)
- **a** — Add new connection
- **e** — Edit selected connection
- **Delete/Backspace** — Delete selected connection
- **Esc** — Cancel/close form
- **↑/↓** — Navigate connection list

### Mouse Support
- Mouse support enabled via `useMouse: true` in renderer config
- Single-click on connection item selects it
- Double-click on connection item connects to it
- Toolbar buttons are clickable: new (a), edit (e), connect (Enter), delete (Del), quit (Ctrl+Q)
- Mouse events use `onMouseDown` handler on connection item Box components

### ANSI Color Normalization
SGR codes 30-37/40-47 normalized to 0-7, 90-97/100-107 normalized to 8-15 to match Cell type's 0-255 ANSI index spec.

### SSH State Machine
`SshConnectionState`: Disconnected → Connecting → Connected → Disconnected

## Commands

```bash
bun run start   # Run the application
```

## Code Conventions

- TypeScript strict mode
- Classes for stateful components (App, SshConnection, ScreenBuffer, ConnectionStore)
- Factory functions for UI components (createSidebar, createConnectionForm, etc.)
- EventEmitter for SSH connection events
- Async/await for initialization and SSH operations

## Important Notes

- **Ctrl+C does NOT exit** — `exitOnCtrlC: false` in index.ts. Ctrl+C is forwarded to SSH shell when connected, does nothing when disconnected.
- **Master password** — On first launch, a master password dialog appears. This password encrypts/decrypts all stored credentials.
- **ssh2-no-cpu-features** — Used over ssh2 because native cpu-features module fails on Bun.
