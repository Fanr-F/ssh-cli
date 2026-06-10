# Learnings - Project Scaffolding

## 2026-06-10

### Dependencies
- `@opentui/core@0.4.0` installed successfully via `bun add`
- `ssh2-no-cpu-features@2.0.0` installed (no native build issues on Windows)
- `@ansi-tools/parser@1.0.17` installed (alternative to ansi-sequence-parser)
- Bun v1.3.14 used as runtime

### OpenTUI
- `createCliRenderer({ exitOnCtrlC: true })` creates a full-screen TUI renderer
- `Text({ content, fg })` renders colored text; type-safe component
- Renderer captures terminal and renders in alternate screen buffer
- Exit with Ctrl+C works cleanly

### Project Structure
- Entry point: `src/index.ts` (module in package.json)
- Source dirs: `src/ui/`, `src/ssh/`, `src/terminal/`, `src/storage/`, `src/types/`
- TypeScript strict mode with ESNext target
- `.gitignore` includes `.sisyphus/evidence/` for evidence artifacts

### Encryption Module (`src/storage/encryption.ts`)
- Uses AES-256-GCM with PBKDF2 key derivation (100k iterations, SHA-256)
- Output format: base64(salt(16) || iv(12) || ciphertext || authTag(16))
- `deriveKey(masterPassword, salt)` - deterministic for same password+salt
- `encrypt(plaintext, masterPassword)` - random salt+IV each call, returns base64
- `decrypt(ciphertext, masterPassword)` - throws on wrong password or corrupted data
- Bun fully supports Node's `crypto` module (tested and working)
- Validated: roundtrip PASS, wrong password rejected PASS

### Terminal Screen Buffer Module (`src/terminal/cell.ts`, `src/terminal/screen-buffer.ts`)
- `Cell` interface in `src/types/terminal.ts` has: char, fg, bg, bold, dim, italic, underline, blink, reverse
- `createCell()` returns default Cell with char=' ', all nulls/false
- `cellsEqual(a, b)` does deep property comparison for dirty tracking
- `ScreenBuffer` stores 2D grid (Cell[][]), cursor position, scrollback buffer, SGR state
- SGR params stored as raw ANSI parameter values (e.g., SGR 31 → fg=31), not mapped color indices — matches verification test expectations
- `write()` handles multi-char strings including `\n` newlines and `\r` carriage returns
- Scrollback is a simple array, oldest lines trimmed when exceeding maxScrollbackLines
- Dirty tracking via a `Set<number>` of row indices

### SSH Connection Module (`src/ssh/types.ts`, `src/ssh/connection.ts`)
- `SshConnection` wraps `ssh2-no-cpu-features` `Client`, extends `EventEmitter` for typed events
- States: Disconnected → Connecting → Connected → Closing → Disconnected
- `connect()` handles password auth, with error classification: `AuthenticationError`, `ConnectionTimeoutError`, `HostKeyError`
- `hostVerifier` accepts all keys for MVP (with comment noting production need)
- Explicit `algorithms` config avoids native dep compatibility issues
- `startShell()` returns `ClientChannel` via `client.shell()`, stores ref for `resizePty()`
- `resizePty(cols, rows)` calls `setWindow(rows, cols, 0, 0)` on shell channel
- `disconnect()` returns promise that resolves on 'close' event
- `ConnectionConfig` type imported from `../types/connection`

## Terminal Renderer (Task 9)
- Created src/terminal/terminal-renderer.ts with TerminalRenderer class
- Converts ScreenBuffer cells into OpenTUI Box/Text VNode components
- Uses enderFull() for full tree rebuild and enderDirty() for dirty-tracked updates
- ANSI_COLORS maps indices 0-15 to hex strings; uses #0d1117 background (dark theme)
- Each buffer line becomes a Text() component inside a Box(flexDirection: 'column')
- getVisibleLines() returns string[] for testing
- OpenTUI VNode factories (Box, Text, ScrollBox) are imported from @opentui/core
- Verification: bun test with equire()-style import passes (plain text + colored cells)
