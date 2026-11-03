# AGENTS.MD

## Project Overview

**ssh-cli** is a keyboard-driven terminal-based SSH client with an interactive TUI. It manages SSH connections, authenticates with key or password, and provides a live remote shell with native VT emulation.

- **Runtime**: Bun
- **UI Framework**: OpenTUI (@opentui/core)
- **Terminal Emulation**: `@opentui/core` `EmbeddedTerminalRenderable` (Ghostty VT)
- **SSH Library**: ssh2-no-cpu-features
- **Language**: TypeScript (strict mode)
- **Documentation**: [English](README.md) | [中文](README.zh.md)

## Project Structure

```
src/
├── index.ts              # Entry point - creates renderer with { exitOnCtrlC: false, useMouse: true }
├── app.ts                # Main application class - layout, focus management, keyboard routing, multi-tab
├── theme.ts              # Tokyo Night palette + semantic colour tokens
├── color.ts              # Hex → RGBA conversion cache for StyledText chunks
├── logger.ts             # Logging system (LogTape, writes to ~/.ssh-cli/ssh-cli.log)
├── app/                  # Extracted application helpers
│   ├── clipboard.ts      # Selection copy + paste target routing
│   ├── terminal-tab.ts   # EmbeddedTerminalRenderable factory
│   └── tab-navigation.ts # Pure next/previous/jump tab helpers
├── ssh/                  # SSH connection layer
│   ├── auth.ts           # Authentication config builder (key/password)
│   ├── connection.ts     # SSH session lifecycle (SshConnection class) + startSftp()
│   ├── known-hosts.ts    # TOFU host-key pinning and SHA-256 fingerprint checks
│   ├── alt-screen.ts     # Tracks alternate-screen (ESC[?1049h/l) to route PageUp/PageDown
│   └── types.ts          # SSH types (SshConnectionState, errors)
├── sftp/                 # SFTP file manager module
│   ├── sftp-client.ts    # SFTP client wrapper (readdir, mkdir, upload, download, etc.)
│   ├── sftp-tab.ts       # SFTP dual-panel tab (cmd mode, chunked file list, ScrollBox)
│   ├── file-list.ts      # Directory listing, formatting, 32-line chunk rendering
│   ├── command-parser.ts # `:` command parsing, path resolution, completion
│   ├── paths.ts          # Remote POSIX path helpers
│   └── types.ts          # SFTP types (FileEntry, PanelSide)
├── storage/              # Persistence layer
│   ├── config.ts         # Config paths, 0600/0700 permissions, atomic writes
│   ├── connections.ts    # ConnectionStore CRUD + legacy credential migration
│   ├── credentials.ts    # Bun.secrets wrapper (password / passphrase)
│   └── schema.ts         # Config validation and secret stripping
├── types/                # Shared TypeScript interfaces
│   └── connection.ts     # ConnectionConfig interface
└── ui/                   # OpenTUI UI components
    ├── sidebar.ts        # Connection list sidebar (ScrollBox with mouse selection)
    ├── connection-form.ts # Add/edit connection modal form
    ├── status-bar.ts     # One-line status bar for operation results and errors
    ├── terminal-panel.ts # Terminal display panel (with setVisible())
    ├── tab-bar.ts        # Multi-tab bar (Alt+↑/↓ cycle, F2-F12 jump, type field: terminal|sftp)
    ├── toolbar.ts        # Clickable shortcut toolbar at top
    ├── divider.ts        # Draggable sidebar divider
    ├── form-model.ts     # Add/edit form state, validation, config building
    ├── password-field.ts # Hand-rendered masked password input
    ├── confirm-dialog.ts # Reusable modal confirmation (dangerous actions)
    └── help-popup.ts     # Draggable help popup (F1) with SFTP shortcuts
```

`tests/` mirrors the `src/` layout (`tests/sftp/sftp-tab.test.ts`,
`tests/ui/connection-form.test.ts`, …). Tests run with `bun test`; `tsc --noEmit`
typechecks both `src/` and `tests/`.

## Key Patterns

### Focus Zones
The app uses a focus zone system: `sidebar`, `terminal`, `form`, `sftp`. Keyboard events are routed based on the current focus. Use `Alt+←/→` to switch between sidebar and terminal; opening a form or an SFTP tab moves focus automatically.

### Keyboard Shortcuts — single source of truth

**All key bindings live in `src/keymap/bindings.ts`.** Do not hand-write shortcut tables anywhere else.

- `src/keymap/bindings.ts` — the binding table (`id`, `scope`, `key`, `group`, `en`, `zh`, `when`)
- `src/keymap/matcher.ts` — `normalizeKey()` (terminal quirks: Alt arrow escape sequences) and pattern matching
- `src/keymap/index.ts` — docs generation (`buildDocs()`)
- `src/app.ts` — `dispatchKey()` → `actions` table, ordered by scope:
  `system` → `help` / `form` (modal) → `global` → current focus
- `src/sftp/sftp-tab.ts` / `src/ui/connection-form.ts` — look up the same table for their own scope (`owner: 'component'`)
- `src/ui/help-popup.ts` — renders `buildDocs('en')`
- `README.md` / `README.zh.md` — generated sections between `<!-- shortcuts:begin -->` and `<!-- shortcuts:end -->`; run `bun run docs` after changing bindings

Adding a shortcut:
1. add a row to `BINDINGS` (or extend an existing binding's `key` array);
2. implement the action under the same `id` in `App.actions`, or in the owning component (`owner: 'component'`);
3. run `bun run docs`.

Key behaviors that are easy to break:
- **There is no copy/paste key binding.** Copying happens on mouse text selection (`renderer` emits `CliRenderEvents.SELECTION`, `App.copyText()` writes the clipboard); pasting is right-click only. `Ctrl+C` / `Ctrl+V` therefore reach whatever has focus: the remote shell in `terminal`, the native `InputRenderable` in `form`, etc. Do not re-add copy/paste shortcuts.
- When the help popup or the form is open, only `system` bindings (`Ctrl+Q`, `F1`) plus that modal's own scope are active.
- Unmatched keys in `terminal` scope must **not** be `preventDefault()`-ed — they are encoded by the native terminal and sent to the remote shell.
- Unmatched keys in `form` scope are **passed through** (no `preventDefault`, no delegation) so the focused `InputRenderable` handles them natively (cursor, drag-select, `Shift+←/→`, `Ctrl+A`, undo). The only exception is `form.captureRawKeys()` → `true` for the hand-rendered password field.
- Closing a tab is mouse-only for now (double-click); the old `Ctrl+Shift+C` binding was removed — see README "Known Issues".

### Mouse Support
- Mouse support enabled via `useMouse: true` in index.ts renderer config
- **Sidebar items**: `onMouseDown` handles single-click (select) and double-click (connect)
- **Text selection**: handled by OpenTUI; `App` listens for `CliRenderEvents.SELECTION` and copies automatically
- **Right-click = paste**: terminal (`App.connectTo()` overrides `term.onMouseDown/onMouseUp`, keeping `forwardMouse` for other buttons), SFTP root container (command mode only), form fields (`onPasteRequest`)
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
- Tabs stored in `Map<string, { term, ssh, config, sftpClient?, sftpTab? }>`
- Tab bar manages tab switching and closing
- Each tab has its own `EmbeddedTerminalRenderable` (native, registered in `terminal-panel.ts`)
- Active tab ID tracked via `tabBar.getActiveTabId()`
- Key input / paste / wheel scroll / selection / resize are handled by the renderable itself;
  the app only routes focus and global shortcuts

### SFTP File Manager
- **Dual-panel layout**: Local (left) / Remote (right)
- **Independent SSH connections**: Each SFTP tab creates its own SSH connection. This isolates transport failures and keeps teardown simple; reusing the terminal transport would require ref-counting across terminal/SFTP tabs
- **Command line mode** (`:`): persistent mode, Enter executes but stays in mode, Esc exits
- **Commands**: `upload <local> <remote>`, `download <remote> <local>`, `mkdir <path>`, `rm [path]`, `mv <src> <dst>`, `cd <path>`, `refresh`, `hidden [on|off]`
- **ScrollBox scrolling**: Each list is a `ScrollBox` (built-in scrollbar / wheel / auto-hide, `viewportCulling`); `ensureIndexVisible()` calls `scrollTo()` to keep the selected row in view
- **Chunked list rendering**: File lines are grouped into 32-line `TextRenderable`s. Moving the cursor redraws only the old/new chunks (O(32)) instead of the whole directory; directory reloads rebuild the chunks
- **Load generation + TTL**: Local and remote loads each have a token so stale responses are discarded; switching back to a tab reuses the listing for 2 seconds
- **Transfer progress**: `upload`/`download` pass `onProgress` and redraw the SFTP status line at most ~10 times per second, showing percentage / bytes / speed; `command history` keeps the last 100 entries
- **Remote cd resolution**: Relative paths resolved against `remoteState.currentPath`
- **Tab close independence**: Closing one tab doesn't affect others

### SSH State Machine
`SshConnectionState`: Disconnected → Connecting → Connected → Disconnected

## Commands

```bash
bun run start       # Run the application
bun run typecheck   # tsc --noEmit
bun test            # Bun test suite
bun run docs        # Regenerate shortcut tables in README.md / README.zh.md
bun run build:win   # Compile the Windows executable → dist/ssh-cli.exe
```

No linter or formatter configured. TypeScript strict mode and tests are enforced by `.github/workflows/ci.yml`.

## Code Conventions

- TypeScript strict mode
- Classes for stateful components (App, SshConnection, ConnectionStore)
- Factory functions for UI components (createSidebar, createTerminalPanel, etc.)
- EventEmitter for SSH connection events
- Async/await for initialization and SSH operations
- Tokyo Night color palette for UI theming

## Important Notes

- **Ctrl+C does NOT exit** — `exitOnCtrlC: false` in index.ts. It is no longer bound: it reaches the remote shell (`SIGINT`) when the terminal has focus. Copying is done by selecting text (auto-copy), pasting by right-click.
- **Form inputs are real `InputRenderable`s** — `App.dispatchKey()` only consumes keys that match a `form` binding (`Tab` / `Esc` / `Enter` / `↑↓` / auth `←→`); everything else falls through to the focused input so cursor / selection / undo work natively. `focusCurrentInput()` calls `selectAll()` so keyboard field switching keeps the "typing replaces the value" behavior; mouse clicks pass `false` so the click places the caret instead. The password field stays hand-rendered (no mask support in OpenTUI) and is fed raw keys via `FormAPI.captureRawKeys()`. Paste (right-click and bracketed paste) goes through `FormAPI.pasteText()`, never through fake key events.
- **Form mouse handlers call `e.preventDefault()`** — the renderer's `autoFocus` walks up from the clicked renderable and would otherwise focus the overlay, blurring the `InputRenderable` (no caret, keys lost).
- **Close-tab has no keyboard shortcut** — `Ctrl+Shift+C` was removed: legacy terminals (Windows Terminal / VS Code) drop the Shift modifier (`0x03`), and host terminals bind it to "Copy". Double-clicking a tab is the only way for now. The `tab.close` action is still registered in `app.ts` so a future binding only needs a new row in `src/keymap/bindings.ts`.
- **ssh2-no-cpu-features** — Used over ssh2 because native cpu-features module fails on Bun.
- **Native VT** — Terminal emulation is `EmbeddedTerminalRenderable` from `@opentui/core` (Ghostty VT), NOT a custom ANSI parser. Scrollback lives inside the native terminal (`maxScrollback`).
- **No public scroll API** — PageUp/PageDown call the zig binding `contextEmbeddedTerminalScroll` via `(term as any).lib` (negative = older lines); mouse wheel scrolling is built in.
- **PageUp/PageDown routing** — `src/ssh/alt-screen.ts` scans the SSH byte stream for `ESC[?<modes>(h|l)` and exposes `active`; combined private modes such as `ESC[?1049;25h` are supported. While active (vim/less/htop/mc/tmux), `PageUp`/`PageDown` are re-encoded with `term.encodeKey()` and written to the shell instead of scrolling locally; `Shift+PageUp/PageDown` always scroll locally. `1048` is intentionally NOT matched — it only saves/restores the cursor, it does not switch buffers.
- **Credentials are not in config.json** — Passwords and key passphrases are stored via `Bun.secrets` (OS keychain). `~/.ssh-cli/config.json` contains metadata only; legacy plaintext entries are migrated on load and stripped by `storage/schema.ts`. On Linux this requires a Secret Service provider.
- **Host keys are pinned (TOFU)** — `ssh/known-hosts.ts` stores SHA-256 fingerprints in `~/.ssh-cli/known_hosts.json`; a changed key rejects the connection. The first connection is auto-trusted and logged.
- **Logs are private and opt-in for I/O** — `~/.ssh-cli/ssh-cli.log` is `0600`, rotates at 2 MB, and terminal I/O previews require both debug logging and `SSH_CLI_LOG_IO=1`; previews are redacted.
- **Platform-specific OpenTUI** — `@opentui/core-win32-x64` is a separate dependency for Windows.
