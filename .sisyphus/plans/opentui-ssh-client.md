# OpenTUI SSH Client — Work Plan

## TL;DR

> **Quick Summary**: Build a terminal-based SSH client using OpenTUI (@opentui/core) with a connection sidebar and an ANSI-rendered terminal panel. Uses ssh2-no-cpu-features for SSH, @ansi-tools/parser for ANSI decoding, and AES-256-GCM encrypted local storage for connection configs.
>
> **Deliverables**:
> - Executable TUI SSH client (`bun run src/index.ts`)
> - Flat connection list with CRUD operations
> - SSH terminal session with ANSI 16-color rendering
> - Encrypted connection config persistence (`~/.ssh-cli/config.json`)
> - Master password decryption on startup
> - Basic vim support (cursor positioning + colors)
>
> **Estimated Effort**: Medium-Large (~15-18 tasks)
> **Parallel Execution**: YES — 4 waves + 1 final verification wave
> **Critical Path**: Task 1 (scaffold) → Task 3 (screen buffer) → Task 6 (ANSI processor) → Task 9 (terminal renderer) → Task 14 (integration) → Final verification

---

## Context

### Original Request
Create an SSH client tool based on OpenTUI with:
1. Left sidebar tree structure for SSH connections
2. Right-side terminal panel for SSH session
3. CRUD operations for connection info
4. Terminal output highlighting
5. Vim color scheme/highlight support

### Interview Summary
**Key Decisions**:
- **Runtime**: Bun (required by OpenTUI), target Windows + macOS
- **UI API**: @opentui/core imperative (no React/Solid)
- **SSH Library**: `ssh2-no-cpu-features` (avoids native dep issues on Bun)
- **ANSI Parser**: `@ansi-tools/parser` (DEC-compliant, not `ansi-sequence-parser`)
- **Terminal Architecture**: 2D cell grid screen buffer with cursor tracking + dirty-cell diff rendering
- **Authentication**: SSH key + password (AES-256-GCM encrypted storage)
- **Password Storage**: Master password prompt on startup → decrypt `~/.ssh-cli/config.json`
- **Connection Tree**: Simple flat list (no groups)
- **Terminal Depth**: MVP scope — 16-color ANSI, cursor positioning, scrolling
- **Test Strategy**: No automated tests; Agent-Executed QA only

### Metis Review
**Identified Gaps** (addressed):
- **Gap 1 (CRITICAL)**: `ansi-sequence-parser` corrupts cursor movement. **Fixed**: Use `@ansi-tools/parser` (DEC/ECMA-48 compliant)
- **Gap 2 (CRITICAL)**: ssh2 native deps fail on Bun. **Fixed**: Use `ssh2-no-cpu-features` fork
- **Gap 3 (CRITICAL)**: Need proper screen buffer. **Fixed**: Build 2D cell grid with cursor tracking, scrollback, dirty cells
- **Gap 4 (HIGH)**: Ctrl+C routing. **Fixed**: Forward to SSH when terminal focused; global exit on Escape/Ctrl+Q
- **Gap 5 (HIGH)**: Terminal resize. **Fixed**: Debounced handler calling `stream.setWindow()`
- **Gap 6 (MEDIUM)**: Windows validation. **Fixed**: Day-1 skeleton validation sprint

---

## Work Objectives

### Core Objective
Build a functional SSH TUI client that allows users to manage SSH connections and interact with remote shells in a split-panel terminal UI.

### Concrete Deliverables
- `src/index.ts` — Entry point
- `src/app.ts` — Main application with layout and focus management
- `src/ui/sidebar.ts` — Connection list panel
- `src/ui/terminal-panel.ts` — SSH terminal rendering panel
- `src/ui/connection-form.ts` — Add/edit connection modal
- `src/ui/status-bar.ts` — Status bar
- `src/ssh/connection.ts` — SSH connection lifecycle
- `src/ssh/auth.ts` — Authentication handling
- `src/terminal/screen-buffer.ts` — 2D cell grid terminal buffer
- `src/terminal/ansi-processor.ts` — ANSI parser → screen buffer
- `src/terminal/terminal-renderer.ts` — Screen buffer diff → OpenTUI
- `src/terminal/cell.ts` — Terminal cell type
- `src/storage/config.ts` — File path initialization
- `src/storage/encryption.ts` — AES-256-GCM encryption
- `src/storage/connections.ts` — Connection config CRUD
- `src/types/connection.ts` — Connection types
- `src/types/terminal.ts` — Terminal types

### Definition of Done
- [ ] `bun run src/index.ts` launches the TUI
- [ ] User can see connection list, add/edit/delete connections
- [ ] User can select a connection and connect to SSH server
- [ ] Remote shell output renders with correct ANSI colors
- [ ] Keyboard input is forwarded to SSH session
- [ ] Connection configs are encrypted and persisted
- [ ] Master password unlocks config on startup
- [ ] Vim output renders with basic colors

### Must Have
- Flat connection list with CRUD
- SSH key + password authentication
- ANSI 16-color rendering in terminal panel
- Working keyboard forwarding (arrow keys, Ctrl+C, Tab)
- Encrypted config storage with master password
- Connection add/edit/delete form UI
- Scrollable terminal output
- Terminal resize handling
- Connection error handling (graceful messaging)

### Must NOT Have (Guardrails)
- NO `ansi-sequence-parser` in production code
- NO SFTP, port forwarding, multi-hop SSH
- NO connection groups/folders/tags
- NO 24-bit true color rendering (16 colors + 256 palette only)
- NO alternate screen buffer for vim
- NO mouse support
- NO Node.js fallback (Bun only)

---

## Verification Strategy

> **ZERO HUMAN INTERVENTION** — ALL verification is agent-executed. No exceptions.

### Test Decision
- **Infrastructure exists**: NO
- **Automated tests**: None (Agent-Executed QA only)
- **Framework**: N/A

### QA Policy
Every task MUST include agent-executed QA scenarios.
Evidence saved to `.sisyphus/evidence/task-{N}-{scenario-slug}.{ext}`.

- **Backend/Logic**: Bash (bun REPL) — Import modules, call functions, assert return values
- **UI Components**: OpenTUI programmatic rendering + `renderer.keyInput.emit()` for keyboard simulation
- **SSH/Network**: Mock SSH server via ssh2 Server class or local TCP server
- **Encryption**: Bun scripts with known plaintext → encrypt → decrypt → verify roundtrip
- **Screen Buffer**: Programmatic ANSI input → assert cell grid state

---

## Execution Strategy

### Parallel Execution Waves

```
Wave 1 (Foundation — Start Immediately, 5 parallel tasks):
├── Task 1: Project scaffolding + dependency installation
├── Task 2: Type definitions
├── Task 3: Screen buffer core (2D cell grid + cursor)
├── Task 4: Encryption module (AES-256-GCM)
└── Task 5: Config storage paths + initialization

Wave 2 (Core Modules — After W1, 5 parallel tasks):
├── Task 6: ANSI processor (@ansi-tools/parser → screen buffer)
├── Task 7: SSH connection module (ssh2 wrapper)
├── Task 8: Auth module (key parsing, password)
├── Task 9: Terminal renderer (screen buffer → OpenTUI components)
└── Task 10: Connections CRUD (JSON read/write + encrypt/decrypt)

Wave 3 (UI Components — After W2, 4 parallel tasks):
├── Task 11: Sidebar (connection list UI)
├── Task 12: Connection form (add/edit/delete UI)
├── Task 13: Terminal panel (OpenTUI terminal display)
└── Task 14: Status bar

Wave 4 (Integration — After W3, 2 sequential tasks):
├── Task 15: Main app + layout + focus management + keyboard routing
└── Task 16: SSH ↔ terminal bridge integration

Wave FINAL (After ALL tasks — 4 parallel reviews):
├── Task F1: Plan compliance audit
├── Task F2: Code quality review
├── Task F3: Real manual QA
└── Task F4: Scope fidelity check
```

### Dependency Matrix

| Task | Blocked By | Blocks |
|------|-----------|--------|
| 1    | None      | 2, 3, 4, 5 |
| 2    | 1         | 6, 7, 8, 9, 10 |
| 3    | 1         | 6, 9 |
| 4    | 1         | 10 |
| 5    | 1         | 10 |
| 6    | 2, 3      | 15 |
| 7    | 2         | 15, 16 |
| 8    | 2         | 15 |
| 9    | 2, 3      | 13, 15 |
| 10   | 2, 4, 5   | 15 |
| 11   | 2         | 15 |
| 12   | 2         | 15 |
| 13   | 9         | 15 |
| 14   | 2         | 15 |
| 15   | 6-14      | 16 |
| 16   | 15        | F1-F4 |
| F1-F4| 16        | — |

### Agent Dispatch Summary

- **Wave 1**: 5 tasks → `quick` (scaffold), `deep` (screen buffer), `quick` (types, encryption, config)
- **Wave 2**: 5 tasks → `deep` (ANSI processor), `unspecified-high` (SSH, auth), `quick` (renderer, CRUD)
- **Wave 3**: 4 tasks → `visual-engineering` (sidebar, form, panel, status bar)
- **Wave 4**: 2 tasks → `deep` (app), `deep` (bridge)
- **Final**: 4 tasks → `oracle`, `unspecified-high` × 2, `deep`

---

## TODOs

- [x] 1. Project Scaffolding + Dependency Installation

  **What to do**:
  - Initialize Bun project: `bun init -y`
  - Create `tsconfig.json` with strict TypeScript settings
  - Create `.gitignore` (node_modules, dist, .env, .sisyphus/evidence/)
  - Install dependencies:
    - `@opentui/core` (latest, ~0.2.x)
    - `ssh2-no-cpu-features` (instead of ssh2 — avoids native dep issue on Bun)
    - `@ansi-tools/parser` (DEC-compliant ANSI parser)
  - Create directory structure: `src/ui/`, `src/ssh/`, `src/terminal/`, `src/storage/`, `src/types/`
  - Create `src/index.ts` with a minimal "Hello OpenTUI" test to validate OpenTUI renders on the target platform
  - Run the hello-world test on Windows Terminal to confirm OpenTUI works

  **Must NOT do**:
  - Do NOT install `ssh2` (official) — use `ssh2-no-cpu-features`
  - Do NOT install `ansi-sequence-parser`
  - Do NOT add any React/Solid dependencies

  **Recommended Agent Profile**:
  - **Category**: `quick`
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: NO (foundation task)
  - **Parallel Group**: Wave 1
  - **Blocks**: 2, 3, 4, 5
  - **Blocked By**: None

  **References**:
  - OpenTUI Getting Started: `https://opentui.com/docs/getting-started/`
  - ssh2-no-cpu-features: `https://www.npmjs.com/package/ssh2-no-cpu-features`
  - @ansi-tools/parser: `https://www.npmjs.com/package/@ansi-tools/parser`

  **Acceptance Criteria**:

  **QA Scenarios (MANDATORY)**:

  ```
  Scenario: Project compiles and runs hello world
    Tool: Bash
    Preconditions: Project is scaffolded, all deps installed
    Steps:
      1. Run: bun run src/index.ts
      2. Observe that OpenTUI renders (app runs without crash)
    Expected Result: OpenTUI starts, shows "Hello OpenTUI" text (or similar minimal output), exits cleanly on Ctrl+C
    Failure Indicators: Process crashes, missing module errors, native renderer fails to load
    Evidence: .sisyphus/evidence/task-1-hello-world.txt

  Scenario: ssh2-no-cpu-features can be imported without error
    Tool: Bash
    Preconditions: Dependencies installed
    Steps:
      1. Run: bun -e "const Client = require('ssh2-no-cpu-features').Client; console.log('OK:', typeof Client)"
    Expected Result: Outputs: "OK: function"
    Failure Indicators: Module not found, native binding errors
    Evidence: .sisyphus/evidence/task-1-ssh2-import.txt
  ```

  **Evidence to Capture**:
  - [ ] task-1-hello-world.txt (console output of hello world test)
  - [ ] task-1-ssh2-import.txt (import verification)

  **Commit**: YES
  - Message: `chore: scaffold project with Bun + OpenTUI deps`
  - Files: package.json, tsconfig.json, .gitignore, src/index.ts

---

- [x] 2. Type Definitions

  **What to do**:
  - Create `src/types/connection.ts` with:
    ```typescript
    interface ConnectionConfig {
      id: string;           // UUID
      name: string;         // Display name
      host: string;         // Hostname/IP
      port: number;         // Default: 22
      username: string;
      authType: 'key' | 'password';
      privateKeyPath?: string;  // For key auth
      password?: string;        // Encrypted, stored only if authType='password'
      createdAt: string;        // ISO date string
      lastConnectedAt?: string; // ISO date string
    }
    ```
  - Create `src/types/terminal.ts` with:
    ```typescript
    interface Cell {
      char: string;
      fg: number | null;   // ANSI color index (0-255) or null (default)
      bg: number | null;   // ANSI color index (0-255) or null (default)
      bold: boolean;
      dim: boolean;
      italic: boolean;
      underline: boolean;
      blink: boolean;
      reverse: boolean;    // Reverse video
    }

    interface CursorPosition {
      row: number;
      col: number;
      visible: boolean;
    }

    interface ScreenBufferState {
      rows: number;
      cols: number;
      cursor: CursorPosition;
      grid: Cell[][];
      scrollback: Cell[][];  // Lines scrolled off the top
    }
    ```

  **Must NOT do**:
  - Do NOT add any runtime logic (types only)
  - Do NOT use `any` types

  **Recommended Agent Profile**:
  - **Category**: `quick`
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES (with 3, 4, 5)
  - **Parallel Group**: Wave 1 (with 3, 4, 5)
  - **Blocks**: 6, 7, 8, 9, 10, 11, 12, 14
  - **Blocked By**: 1

  **References**:
  - OpenTUI color constants: OpenTUI uses ANSI color conventions. Reference: https://opentui.com/docs/core-concepts/colors

  **Acceptance Criteria**:

  **QA Scenarios (MANDATORY)**:

  ```
  Scenario: TypeScript types compile correctly
    Tool: Bash
    Preconditions: Project scaffolded (Task 1), src/types/*.ts created
    Steps:
      1. Run: bun build src/types/connection.ts --outdir /dev/null 2>&1 || true
      2. Verify no type errors reported
    Expected Result: Types compile without errors
    Failure Indicators: TypeScript compilation errors, missing imports
    Evidence: .sisyphus/evidence/task-2-types-compile.txt

  Scenario: ConnectionConfig structure is valid
    Tool: Bash
    Preconditions: src/types/connection.ts exists
    Steps:
      1. Run: bun -e "
        import { type ConnectionConfig } from './src/types/connection';
        const c: ConnectionConfig = {
          id: 'test-id', name: 'Test', host: 'example.com',
          port: 22, username: 'user', authType: 'password',
          createdAt: new Date().toISOString()
        };
        console.log('OK:', c.host);
      "
    Expected Result: TypeScript accepts the object shape, prints "OK: example.com"
    Failure Indicators: TypeScript errors about missing/extra properties
    Evidence: .sisyphus/evidence/task-2-connection-type.txt
  ```

  **Evidence to Capture**:
  - [ ] task-2-types-compile.txt
  - [ ] task-2-connection-type.txt

  **Commit**: YES (group with Task 1)
  - Message: `chore: scaffold project with Bun + OpenTUI deps`
  - Files: src/types/connection.ts, src/types/terminal.ts

---

- [x] 3. Screen Buffer Core (2D Cell Grid + Cursor + Scrollback)

  **What to do**:
  - Implement `src/terminal/cell.ts`:
    - `createCell(): Cell` — Create default cell (space char, default colors)
    - `cellToString(cell: Cell): string` — Render cell for display (handle reverse video)
  - Implement `src/terminal/screen-buffer.ts` as a class:
    - `constructor(rows: number, cols: number)`
    - Properties: `rows`, `cols`, `grid[][]`, `cursor`, `scrollback[]`
    - Methods:
      - `resize(rows: number, cols: number)` — Resize grid, keep content
      - `write(char: string)` — Write char at cursor, advance cursor
      - `writeLine(text: string)` — Write text at cursor with wrapping
      - `setCursor(row: number, col: number)` — Absolute position (1-indexed)
      - `moveCursor(dRow: number, dCol: number)` — Relative movement
      - `newLine()` — Move cursor to next line (scroll if at bottom)
      - `carriageReturn()` — Move cursor to column 0
      - `backspace()` — Move cursor back one, clear char
      - `clearScreen()` — Clear entire grid
      - `clearLine()` — Clear current line
      - `clearToEndOfLine()` — Clear from cursor to end of line
      - `clearToEndOfScreen()` — Clear from cursor to end of screen
      - `scrollUp(lines: number)` — Scroll grid up by N lines, move content to scrollback
      - `scrollDown(lines: number)` — Scroll grid down by N lines
      - `setSGR(params: number[])` — Parse SGR parameters and set current rendering attributes
      - `getCurrentAttributes()` — Return current fg, bg, bold, etc.
      - `getCell(row: number, col: number): Cell` — Get cell at position
      - `getVisibleLines(): Cell[][]` — Return current visible grid lines
      - `getScrollbackLines(): Cell[][]` — Return scrollback buffer
      - `getMaxScrollbackLines()` — Return max scrollback size (configurable, default 1000)

  **Must NOT do**:
  - Do NOT add any OpenTUI rendering logic (separate task)
  - Do NOT add ANSI parsing (separate task)
  - Do NOT handle escape sequences in this file (just the buffer state machine)

  **Recommended Agent Profile**:
  - **Category**: `deep`
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES (with 2, 4, 5)
  - **Parallel Group**: Wave 1 (with 2, 4, 5)
  - **Blocks**: 6, 9
  - **Blocked By**: 1

  **References**:
  - VT100/xterm terminal behavior: https://vt100.net/docs/vt510-rm/chapter4.html
  - ANSI escape code reference: https://gist.github.com/fnky/458719343aabd01cfb17a3a4f7296797

  **Acceptance Criteria**:

  **QA Scenarios (MANDATORY)**:

  ```
  Scenario: Screen buffer basic write and cursor movement
    Tool: Bash (bun REPL)
    Preconditions: src/terminal/screen-buffer.ts, src/terminal/cell.ts exist
    Steps:
      1. Run: bun -e "
        const { ScreenBuffer } = require('./src/terminal/screen-buffer');
        const buf = new ScreenBuffer(5, 10);
        buf.write('Hello');
        console.log('Cursor:', buf.cursor.row, buf.cursor.col);
        console.log('Cell 0,0:', buf.getCell(0, 0).char);
        console.log('Cell 0,4:', buf.getCell(0, 4).char);
      "
    Expected Result: Cursor at row 0, col 5. Cell[0][0]='H', Cell[0][4]='o'
    Failure Indicators: Wrong cursor position, wrong cell content
    Evidence: .sisyphus/evidence/task-3-basic-write.txt

  Scenario: Scrolling when writing past bottom
    Tool: Bash (bun REPL)
    Preconditions: Screen buffer exists
    Steps:
      1. Create buffer with 3 rows, 10 cols
      2. Write 5 lines of text (each ending with newline)
      3. Read visible lines
    Expected Result: First 2 lines are in scrollback, last 3 lines visible
    Failure Indicators: Content lost instead of scrolled, crash on overflow
    Evidence: .sisyphus/evidence/task-3-scrolling.txt

  Scenario: SGR color state is tracked
    Tool: Bash (bun REPL)
    Preconditions: Screen buffer exists
    Steps:
      1. Run: bun -e "
        const { ScreenBuffer } = require('./src/terminal/screen-buffer');
        const buf = new ScreenBuffer(3, 20);
        buf.setSGR([31]);  // Red foreground
        buf.write('Red');
        const cell = buf.getCell(0, 0);
        console.log('FG:', cell.fg, 'Char:', cell.char);
      "
    Expected Result: Cell has fg=31 (red), char='R'
    Failure Indicators: SGR params not applied, fg is null
    Evidence: .sisyphus/evidence/task-3-sgr-state.txt
  ```

  **Evidence to Capture**:
  - [ ] task-3-basic-write.txt
  - [ ] task-3-scrolling.txt
  - [ ] task-3-sgr-state.txt

  **Commit**: YES
  - Message: `feat: implement terminal screen buffer with 2D cell grid`
  - Files: src/terminal/cell.ts, src/terminal/screen-buffer.ts

---

- [x] 4. Encryption Module (AES-256-GCM)

  **What to do**:
  - Implement `src/storage/encryption.ts`:
    - `deriveKey(masterPassword: string, salt: Buffer): Buffer` — PBKDF2 key derivation (100k iterations, SHA-256)
    - `encrypt(plaintext: string, masterPassword: string): string` — AES-256-GCM encrypt, return base64-encoded (salt:iv:ciphertext:authTag)
    - `decrypt(ciphertext: string, masterPassword: string): string` — Decrypt base64-encoded payload
    - Use Node's `crypto` module (works in Bun)
    - Generate random salt (16 bytes) and IV (12 bytes) for each encryption
    - Auth tag length: 16 bytes
    - Output format: base64(salt(16) + iv(12) + ciphertext + authTag(16))

  **Must NOT do**:
  - Do NOT hardcode salt or IV (must be random per encryption)
  - Do NOT use ECB mode or any mode other than GCM
  - Do NOT store the master password in plaintext anywhere

  **Recommended Agent Profile**:
  - **Category**: `quick`
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES (with 2, 3, 5)
  - **Parallel Group**: Wave 1 (with 2, 3, 5)
  - **Blocks**: 10
  - **Blocked By**: 1

  **References**:
  - Node.js crypto module: https://nodejs.org/api/crypto.html
  - AES-256-GCM in Node: https://nodejs.org/api/crypto.html#cryptocreatecipherivalgorithm-key-iv-options

  **Acceptance Criteria**:

  **QA Scenarios (MANDATORY)**:

  ```
  Scenario: Encrypt then decrypt returns original plaintext
    Tool: Bash (bun REPL)
    Preconditions: src/storage/encryption.ts exists
    Steps:
      1. Run: bun -e "
        const { encrypt, decrypt } = require('./src/storage/encryption');
        const password = 'test-master-password';
        const plaintext = JSON.stringify({ host: 'example.com', port: 22 });
        const encrypted = encrypt(plaintext, password);
        const decrypted = decrypt(encrypted, password);
        console.log('Roundtrip:', plaintext === decrypted ? 'PASS' : 'FAIL');
        console.log('Encrypted length:', encrypted.length);
      "
    Expected Result: Roundtrip: PASS, Encrypted is a non-empty base64 string
    Failure Indicators: Roundtrip fails, encrypted is empty, wrong password decrypts successfully
    Evidence: .sisyphus/evidence/task-4-encrypt-decrypt.txt

  Scenario: Wrong password fails to decrypt
    Tool: Bash (bun REPL)
    Preconditions: Encryption module exists
    Steps:
      1. Run: bun -e "
        const { encrypt, decrypt } = require('./src/storage/encryption');
        const encrypted = encrypt('secret-data', 'correct-password');
        try {
          decrypt(encrypted, 'wrong-password');
          console.log('FAIL: Should have thrown');
        } catch(e) {
          console.log('PASS: Wrong password rejected:', e.message);
        }
      "
    Expected Result: Throws error with "Wrong password" or "Decryption failed" message
    Failure Indicators: Wrong password decrypts successfully, crash instead of graceful error
    Evidence: .sisyphus/evidence/task-4-wrong-password.txt
  ```

  **Evidence to Capture**:
  - [ ] task-4-encrypt-decrypt.txt
  - [ ] task-4-wrong-password.txt

  **Commit**: YES
  - Message: `feat: add AES-256-GCM encryption module`
  - Files: src/storage/encryption.ts

---

- [x] 5. Config Storage Paths + Initialization

  **What to do**:
  - Implement `src/storage/config.ts`:
    - `getConfigDir(): string` — Return `~/.ssh-cli/` (resolved for current OS)
    - `getConfigPath(): string` — Return `~/.ssh-cli/config.json`
    - `ensureConfigDir(): Promise<void>` — Create config directory if not exists
    - `configExists(): Promise<boolean>` — Check if config file exists
    - `getConnectionsPath(): string` — Explicit path for connections file
  - Use `os.homedir()` for cross-platform home directory resolution
  - Create `.gitkeep`-style note that this directory is for app data

  **Must NOT do**:
  - Do NOT read or write any actual connection data (separate task)
  - Do NOT add encryption logic here (separate module)

  **Recommended Agent Profile**:
  - **Category**: `quick`
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES (with 2, 3, 4)
  - **Parallel Group**: Wave 1 (with 2, 3, 4)
  - **Blocks**: 10
  - **Blocked By**: 1

  **References**:
  - Node.js os.homedir(): https://nodejs.org/api/os.html#oshomedir

  **Acceptance Criteria**:

  **QA Scenarios (MANDATORY)**:

  ```
  Scenario: Config directory paths resolve correctly
    Tool: Bash (bun REPL)
    Preconditions: src/storage/config.ts exists
    Steps:
      1. Run: bun -e "
        const { getConfigDir } = require('./src/storage/config');
        const dir = getConfigDir();
        console.log('Config dir:', dir);
        console.log('Contains home:', dir.includes('ssh-cli'));
      "
    Expected Result: Path contains user home directory and ends with 'ssh-cli'
    Failure Indicators: Path is absolute but wrong, doesn't contain 'ssh-cli'
    Evidence: .sisyphus/evidence/task-5-config-path.txt

  Scenario: ensureConfigDir creates directory
    Tool: Bash (bun REPL)
    Preconditions: Config module exists, ~/.ssh-cli does NOT exist (or is cleaned up after)
    Steps:
      1. Run: bun -e "
        const { ensureConfigDir } = require('./src/storage/config');
        await ensureConfigDir();
        console.log('Dir created');
      "
    Expected Result: Directory ~/.ssh-cli/ is created
    Failure Indicators: Permission error, path is wrong, directory not created
    Evidence: .sisyphus/evidence/task-5-ensure-dir.txt
  ```

  **Evidence to Capture**:
  - [ ] task-5-config-path.txt
  - [ ] task-5-ensure-dir.txt

  **Commit**: YES
  - Message: `feat: add config storage path initialization`
  - Files: src/storage/config.ts

---

- [x] 6. ANSI Processor (@ansi-tools/parser → Screen Buffer)

  **What to do**:
  - Implement `src/terminal/ansi-processor.ts` that bridges `@ansi-tools/parser` with the screen buffer:
    - `AnsiProcessor` class:
      - `constructor(buffer: ScreenBuffer)` — Takes a screen buffer instance
      - `process(data: string): void` — Feed raw ANSI string to parser, update buffer
    - Inside `process()`:
      - Use `@ansi-tools/parser` to tokenize the input stream
      - Handle each token type:
        - **TEXT**: Write to buffer via `buffer.write()`
        - **SGR** (Select Graphic Rendition, `m` command): Parse params, call `buffer.setSGR()`
        - **CUU** (`A`): Cursor up → `buffer.moveCursor(-n, 0)`
        - **CUD** (`B`): Cursor down → `buffer.moveCursor(n, 0)`
        - **CUF** (`C`): Cursor forward → `buffer.moveCursor(0, n)`
        - **CUB** (`D`): Cursor back → `buffer.moveCursor(0, -n)`
        - **CUP** (`H` or `f`): Cursor position → `buffer.setCursor(row-1, col-1)`
        - **ED** (`J`): Erase in display → `buffer.clearScreen()`, `buffer.clearToEndOfScreen()`
        - **EL** (`K`): Erase in line → `buffer.clearLine()`, `buffer.clearToEndOfLine()`
        - **SU** (`S`): Scroll up → `buffer.scrollUp(n)`
        - **SD** (`T`): Scroll down → `buffer.scrollDown(n)`
        - **SGR reset** (0 or empty): Reset all attributes
        - **Carriage Return** (`\r`): `buffer.carriageReturn()`
        - **Line Feed** (`\n`): `buffer.newLine()`
        - **Backspace** (`\b`): `buffer.backspace()`
        - **Tab** (`\t`): Write spaces to next tab stop (every 8 cols)
        - Ignore unsupported sequences gracefully (DCS, OSC, DEC private modes)
    - Maintain parser state across chunk boundaries (the parser handles this internally)
    - Track "dirty" flag: `isDirty(): boolean` and `clearDirty()`

  **Must NOT do**:
  - Do NOT handle alternate screen buffer (out of MVP scope)
  - Do NOT handle 24-bit true color SGR sequences (only 0-255 indexed)
  - Do NOT add rendering logic (this module only updates the buffer model)

  **Recommended Agent Profile**:
  - **Category**: `deep`
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES (with 7, 8, 9, 10)
  - **Parallel Group**: Wave 2 (with 7, 8, 9, 10)
  - **Blocks**: 15
  - **Blocked By**: 2, 3

  **References**:
  - @ansi-tools/parser: https://www.npmjs.com/package/@ansi-tools/parser
  - ANSI escape code reference (comprehensive): https://gist.github.com/fnky/458719343aabd01cfb17a3a4f7296797
  - ECMA-48 / ISO 6429 control functions: https://www.ecma-international.org/publications-and-standards/standards/ecma-48/

  **Acceptance Criteria**:

  **QA Scenarios (MANDATORY)**:

  ```
  Scenario: Basic colored text is parsed and rendered in buffer
    Tool: Bash (bun REPL)
    Preconditions: screen-buffer.ts, ansi-processor.ts exist
    Steps:
      1. Run: bun -e "
        const { ScreenBuffer } = require('./src/terminal/screen-buffer');
        const { AnsiProcessor } = require('./src/terminal/ansi-processor');
        const buf = new ScreenBuffer(5, 40);
        const proc = new AnsiProcessor(buf);
        proc.process('\x1b[31mHello\x1b[0m World');
        console.log('Cell fg:', buf.getCell(0, 0).fg, 'char:', buf.getCell(0, 0).char);
        console.log('Cell normal fg:', buf.getCell(0, 6).fg, 'char:', buf.getCell(0, 6).char);
      "
    Expected Result: Cell[0][0] has fg=31, char='H'. Cell[0][6] has fg=null (default), char='W'
    Failure Indicators: All cells have same fg, colors not applied, or output garbled
    Evidence: .sisyphus/evidence/task-6-colored-text.txt

  Scenario: Cursor positioning works correctly
    Tool: Bash (bun REPL)
    Preconditions: screen-buffer.ts, ansi-processor.ts exist
    Steps:
      1. Run: bun -e "
        const { ScreenBuffer } = require('./src/terminal/screen-buffer');
        const { AnsiProcessor } = require('./src/terminal/ansi-processor');
        const buf = new ScreenBuffer(5, 20);
        const proc = new AnsiProcessor(buf);
        proc.process('\x1b[2;5HX');  // Move to row 2, col 5, write X
        console.log('Cursor:', buf.cursor.row, buf.cursor.col);
        console.log('Cell:', buf.getCell(1, 4).char);
      "
    Expected Result: Cursor at row 1, col 5. Cell[1][4]='X'
    Failure Indicators: Wrong position, content at wrong location
    Evidence: .sisyphus/evidence/task-6-cursor-position.txt

  Scenario: Streaming input across chunk boundaries
    Tool: Bash (bun REPL)
    Preconditions: screen-buffer.ts, ansi-processor.ts exist
    Steps:
      1. Run: bun -e "
        const { ScreenBuffer } = require('./src/terminal/screen-buffer');
        const { AnsiProcessor } = require('./src/terminal/ansi-processor');
        const buf = new ScreenBuffer(5, 40);
        const proc = new AnsiProcessor(buf);
        proc.process('\x1b[3');
        proc.process('1mHello');
        console.log('Cell fg:', buf.getCell(0, 0).fg);
      "
    Expected Result: Cell[0][0] has fg=31 despite the escape sequence being split across chunks
    Failure Indicators: fg is null (sequence not recognized), corrupted output
    Evidence: .sisyphus/evidence/task-6-streaming.txt
  ```

  **Evidence to Capture**:
  - [ ] task-6-colored-text.txt
  - [ ] task-6-cursor-position.txt
  - [ ] task-6-streaming.txt

  **Commit**: YES
  - Message: `feat: implement ANSI parser integration with screen buffer`
  - Files: src/terminal/ansi-processor.ts

---

- [x] 7. SSH Connection Module (ssh2 Wrapper)

  **What to do**:
  - Implement `src/ssh/connection.ts`:
    - `SshConnection` class:
      - `connect(config: ConnectionConfig): Promise<void>` — Connect to SSH server
        - Use `Client` from `ssh2-no-cpu-features`
        - Handle `hostVerifier` callback for host key verification (auto-accept for MVP, with logging)
        - Use algorithms: `['curve25519-sha256', 'diffie-hellman-group14-sha256']` (avoid native dep issues)
      - `startShell(options?: ShellOptions): Promise<Channel>` — Start interactive shell session
        - Allocate PTY with configurable cols/rows (default 80x24)
        - Return the Channel stream
      - `resizePty(cols: number, rows: number): void` — Resize remote PTY via `stream.setWindow()`
      - `disconnect(): Promise<void>` — Close connection gracefully
      - Events: `on('ready')`, `on('close')`, `on('error')`
      - `isConnected(): boolean` — Check connection state
    - Handle errors:
      - `AuthenticationError` — Wrong password, bad key
      - `ConnectionTimeoutError` — Host unreachable
      - `HostKeyError` — Host key mismatch
    - Export custom error types

  - Implement `src/ssh/types.ts`:
    - Export `ShellOptions` interface (cols, rows, term env vars)
    - Export `SshConnectionState` enum (disconnected, connecting, connected, closing)

  **Must NOT do**:
  - Do NOT implement file transfer (SFTP)
  - Do NOT implement port forwarding
  - Do NOT implement SSH agent forwarding
  - Do NOT add any UI logic

  **Recommended Agent Profile**:
  - **Category**: `unspecified-high`
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES (with 6, 8, 9, 10)
  - **Parallel Group**: Wave 2 (with 6, 8, 9, 10)
  - **Blocks**: 15, 16
  - **Blocked By**: 2

  **References**:
  - ssh2 Client API: https://github.com/mscdex/ssh2#client
  - ssh2-no-cpu-features: https://www.npmjs.com/package/ssh2-no-cpu-features

  **Acceptance Criteria**:

  **QA Scenarios (MANDATORY)**:

  ```
  Scenario: SSH connection to localhost mock server succeeds
    Tool: Bash (bun REPL)
    Preconditions: src/ssh/connection.ts exists, a mock SSH server is available (or use ssh2 Server class with a test key)
    Steps:
      1. Create a minimal SSH server with ssh2 Server class using test credentials
      2. Create SSH connection config for localhost test
      3. Call sshConnection.connect(config)
      4. Verify connection succeeds
    Expected Result: Connection is established, isConnected() returns true
    Failure Indicators: Connection hangs, throws error, timeout
    Evidence: .sisyphus/evidence/task-7-connect-success.txt

  Scenario: SSH connection with wrong password fails gracefully
    Tool: Bash (bun REPL)
    Preconditions: SSH module exists, mock server with password auth
    Steps:
      1. Try to connect with wrong password
      2. Catch error
    Expected Result: Error is thrown with type AuthenticationError
    Failure Indicators: Connection hangs, crash instead of error, wrong error type
    Evidence: .sisyphus/evidence/task-7-connect-fail.txt
  ```

  **Evidence to Capture**:
  - [ ] task-7-connect-success.txt
  - [ ] task-7-connect-fail.txt

  **Commit**: YES
  - Message: `feat: add SSH connection module with ssh2`
  - Files: src/ssh/connection.ts, src/ssh/types.ts

---

- [x] 8. Auth Module (Key + Password)

  **What to do**:
  - Implement `src/ssh/auth.ts`:
    - `buildConnectConfig(connection: ConnectionConfig): SshConnectConfig` — Build ssh2 connect config
      - If `authType === 'key'`:
        - Read private key from `privateKeyPath` (or default `~/.ssh/id_rsa`, `~/.ssh/id_ed25519`)
        - Parse key with `ssh2.utils.parseKey()`
        - Handle encrypted private keys (prompt for passphrase — return special flag)
      - If `authType === 'password'`:
        - Set `password` field from config (already decrypted at this point)
      - Set `host`, `port`, `username`
      - Set `readyTimeout` (default 10000ms)
      - Set `hostHash`: `'sha256'`
    - `discoverKeys(): string[]` — List available SSH keys from `~/.ssh/`
    - `validateKey(keyPath: string): Promise<boolean>` — Check if key file is valid

  **Must NOT do**:
  - Do NOT store decrypted passwords (they come in already decrypted from storage layer)
  - Do NOT add any built-in key generation

  **Recommended Agent Profile**:
  - **Category**: `unspecified-high`
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES (with 6, 7, 9, 10)
  - **Parallel Group**: Wave 2 (with 6, 7, 9, 10)
  - **Blocks**: 15
  - **Blocked By**: 2

  **References**:
  - ssh2 utils.parseKey: https://github.com/mscdex/ssh2#connection-options

  **Acceptance Criteria**:

  **QA Scenarios (MANDATORY)**:

  ```
  Scenario: Build SSH config for key-based auth
    Tool: Bash (bun REPL)
    Preconditions: src/ssh/auth.ts exists, test key file exists
    Steps:
      1. Run: bun -e "
        const { buildConnectConfig } = require('./src/ssh/auth');
        const config = buildConnectConfig({
          id: 'test', name: 'Test', host: 'example.com', port: 22,
          username: 'user', authType: 'key', privateKeyPath: '~/.ssh/id_ed25519'
        });
        console.log('Host:', config.host);
        console.log('Has privateKey:', !!config.privateKey);
      "
    Expected Result: Config has host, username, and privateKey set (or null if key not found)
    Failure Indicators: Missing required fields, throws unexpected error
    Evidence: .sisyphus/evidence/task-8-key-auth.txt

  Scenario: Build SSH config for password auth
    Tool: Bash (bun REPL)
    Preconditions: src/ssh/auth.ts exists
    Steps:
      1. Run: bun -e "
        const { buildConnectConfig } = require('./src/ssh/auth');
        const config = buildConnectConfig({
          id: 'test', name: 'Test', host: 'example.com', port: 22,
          username: 'user', authType: 'password', password: 'decrypted-password'
        });
        console.log('Has password:', !!config.password);
      "
    Expected Result: Config has password field set
    Failure Indicators: Password missing when authType is password
    Evidence: .sisyphus/evidence/task-8-password-auth.txt
  ```

  **Evidence to Capture**:
  - [ ] task-8-key-auth.txt
  - [ ] task-8-password-auth.txt

  **Commit**: YES
  - Message: `feat: add authentication module (key + password)`
  - Files: src/ssh/auth.ts

---

- [x] 9. Terminal Renderer (Screen Buffer → OpenTUI Components)

  **What to do**:
  - Implement `src/terminal/terminal-renderer.ts`:
    - `TerminalRenderer` class:
      - `constructor(renderer: CliRenderer)` — Takes the OpenTUI renderer instance
      - `setBuffer(buffer: ScreenBuffer)` — Set the screen buffer to render
      - `render(): Renderable` — Build/update OpenTUI component tree from buffer state
      - `renderFull(): Renderable` — Full re-render of all visible lines
      - `renderDirty(): Renderable` — Only re-render changed lines (use dirty tracking)
    - Rendering approach:
      - Create a `Box` (or `ScrollBox`) as the terminal container
      - Each visible line of the buffer renders as a `Text` component
      - Each `Text` component gets styled based on cell attributes:
        - Map ANSI color index (0-15 for standard, 16-255 for extended) to OpenTUI colors
        - Apply bold, dim, italic, underline via OpenTUI `TextAttributes`
        - Handle reverse video by swapping fg/bg
      - Use `ScrollBox` with viewport culling for performance
      - Update only changed lines using the buffer's dirty tracking
    - `getVisibleLines(): string[]` — Return text representation of visible buffer
    - Color mapping:
      - Build a standard 16-color ANSI palette → hex color mapping
      - Standard: black, red, green, yellow, blue, magenta, cyan, white (and bright variants)

  **Must NOT do**:
  - Do NOT handle SSH input/output (separate bridge task)
  - Do NOT implement full 24-bit true color rendering
  - Do NOT add keyboard handling here (focus management task)

  **Recommended Agent Profile**:
  - **Category**: `visual-engineering`
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES (with 6, 7, 8, 10)
  - **Parallel Group**: Wave 2 (with 6, 7, 8, 10)
  - **Blocks**: 13, 15
  - **Blocked By**: 2, 3

  **References**:
  - OpenTUI Text component: https://opentui.com/docs/components/text/
  - OpenTUI Box component: https://opentui.com/docs/components/box/
  - OpenTUI ScrollBox: https://opentui.com/docs/components/scrollbox/
  - ANSI color palette: https://en.wikipedia.org/wiki/ANSI_escape_code#Colors

  **Acceptance Criteria**:

  **QA Scenarios (MANDATORY)**:

  ```
  Scenario: Terminal renderer creates OpenTUI component from buffer
    Tool: Bash (bun REPL) — programmatic renderer creation
    Preconditions: screen-buffer.ts, terminal-renderer.ts exist
    Steps:
      1. Create CliRenderer (headless or test mode)
      2. Create ScreenBuffer with some colored text
      3. Create TerminalRenderer
      4. Call render() and check return type
    Expected Result: Returns an OpenTUI Box or ScrollBox renderable with children
    Failure Indicators: Throws error, returns null/undefined, wrong component type
    Evidence: .sisyphus/evidence/task-9-renderer-output.txt

  Scenario: Colored cells produce correctly styled Text components
    Tool: Bash (bun REPL) — check rendered component properties
    Preconditions: Terminal renderer exists
    Steps:
      1. Create buffer with a red-bold cell and a default cell
      2. Render and inspect the generated Text component options
    Expected Result: The red-bold cell produces Text with correct fg color and bold attribute
    Failure Indicators: Colors don't map, attributes not applied
    Evidence: .sisyphus/evidence/task-9-colored-render.txt
  ```

  **Evidence to Capture**:
  - [ ] task-9-renderer-output.txt
  - [ ] task-9-colored-render.txt

  **Commit**: YES
  - Message: `feat: implement terminal renderer (buffer → OpenTUI)`
  - Files: src/terminal/terminal-renderer.ts

---

- [x] 10. Connections CRUD with Encrypted Storage

  **What to do**:
  - Implement `src/storage/connections.ts`:
    - `ConnectionStore` class:
      - `constructor(masterPassword: string)` — Initialize with master password
      - `load(): Promise<ConnectionConfig[]>` — Load and decrypt connections from `~/.ssh-cli/config.json`
        - If file doesn't exist, return empty array
        - If decryption fails, throw descriptive error
      - `save(connections: ConnectionConfig[], masterPassword: string): Promise<void>` — Encrypt and save
      - `add(connection: ConnectionConfig): Promise<void>` — Load, append, save
      - `update(id: string, updates: Partial<ConnectionConfig>): Promise<void>` — Load, modify, save
      - `remove(id: string): Promise<void>` — Load, filter out, save
      - `getById(id: string): Promise<ConnectionConfig | null>` — Load and find by ID
      - `getAll(): Promise<ConnectionConfig[]>` — Load all connections
    - When saving:
      - Strip `password` field from ConnectionConfig if `authType === 'key'`
      - Generate UUID for new connections via `crypto.randomUUID()`
    - Ensure config directory exists before read/write

  **Must NOT do**:
  - Do NOT store master password in the file
  - Do NOT store unencrypted data in the config file
  - Do NOT add any UI or rendering logic

  **Recommended Agent Profile**:
  - **Category**: `quick`
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES (with 6, 7, 8, 9)
  - **Parallel Group**: Wave 2 (with 6, 7, 8, 9)
  - **Blocks**: 15
  - **Blocked By**: 2, 4, 5

  **References**:
  - crypto.randomUUID: https://nodejs.org/api/crypto.html#cryptorandomuuidoptions

  **Acceptance Criteria**:

  **QA Scenarios (MANDATORY)**:

  ```
  Scenario: Add connection, save, reload, verify persistence
    Tool: Bash (bun REPL)
    Preconditions: encryption.ts, config.ts, connections.ts exist
    Steps:
      1. Run: bun -e "
        const { ConnectionStore } = require('./src/storage/connections');
        const store = new ConnectionStore('test-password');
        await store.add({ id: 'test', name: 'Test', host: 'example.com', port: 22,
          username: 'user', authType: 'key', createdAt: new Date().toISOString() });
        const all = await store.getAll();
        console.log('Count:', all.length);
        console.log('First:', all[0].name);
      "
    Expected Result: Count is 1, name matches
    Failure Indicators: No connections saved, file not created, can't load
    Evidence: .sisyphus/evidence/task-10-crud-add.txt

  Scenario: Delete a connection
    Tool: Bash (bun REPL)
    Preconditions: Connections store exists, has test connection
    Steps:
      1. Add test connection
      2. Remove it by ID
      3. Check getAll returns empty
    Expected Result: Connection is removed, array is empty
    Failure Indicators: Remove throws error, connection still present
    Evidence: .sisyphus/evidence/task-10-crud-delete.txt
  ```

  **Evidence to Capture**:
  - [ ] task-10-crud-add.txt
  - [ ] task-10-crud-delete.txt

  **Commit**: YES
  - Message: `feat: add connections CRUD with encrypted storage`
  - Files: src/storage/connections.ts

---

- [ ] 11. Sidebar (Connection List UI)

  **What to do**:
  - Implement `src/ui/sidebar.ts`:
    - `createSidebar(renderer: CliRenderer, connections: ConnectionConfig[]): BoxRenderable`
    - Create a `Box` with fixed width (e.g., 30) and `flexGrow: 1` for height
    - Title: "Connections"
    - Inside, a scrollable list of connections:
      - Each connection shown as a `Text` item with name, host, username
      - Selected item highlighted with different background color
      - Focusable list with keyboard navigation (up/down arrows)
    - API:
      - `setConnections(connections: ConnectionConfig[])` — Update the list
      - `getSelectedConnection(): ConnectionConfig | null` — Currently selected
      - `selectNext()` / `selectPrevious()` — Move selection
      - `onConnectionSelect(callback: (conn: ConnectionConfig) => void)` — Selection callback
      - `onAction(callback: (action: string, conn: ConnectionConfig) => void)` — Action callbacks (connect, edit, delete)
    - Visual design:
      - Use `borderStyle: "rounded"` for the panel
      - Background color: `#1a1b26` (dark theme)
      - Selected item: `backgroundColor: "#334455"`
      - Connection name in bright white, host/username in gray
      - Show connection status indicator (icon/color dot: green=connected, gray=disconnected)

  **Must NOT do**:
  - Do NOT implement SSH connection logic (separate)
  - Do NOT implement the connection form (separate task)

  **Recommended Agent Profile**:
  - **Category**: `visual-engineering`
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES (with 12, 13, 14)
  - **Parallel Group**: Wave 3 (with 12, 13, 14)
  - **Blocks**: 15
  - **Blocked By**: 2

  **References**:
  - OpenTUI Box component: https://opentui.com/docs/components/box/
  - OpenTUI Text component: https://opentui.com/docs/components/text/

  **Acceptance Criteria**:

  **QA Scenarios (MANDATORY)**:

  ```
  Scenario: Sidebar renders connection list
    Tool: Bash (bun REPL) + programmatic CliRenderer creation
    Preconditions: sidebar.ts exists, connection types exist
    Steps:
      1. Create CliRenderer (headless/test mode)
      2. Create sidebar with test connections
      3. Verify renderable tree has children matching connection count
    Expected Result: Sidebar Box contains N Text children for N connections
    Failure Indicators: No children, wrong count, layout error
    Evidence: .sisyphus/evidence/task-11-sidebar-render.txt

  Scenario: Selection navigation works
    Tool: Bash (bun REPL) + programmatic key events
    Preconditions: sidebar exists with connections
    Steps:
      1. Call selectNext()
      2. Check selected connection changed
    Expected Result: Selected index increments, getSelectedConnection() returns correct item
    Failure Indicators: Selection doesn't change, wraps when it shouldn't
    Evidence: .sisyphus/evidence/task-11-sidebar-navigate.txt
  ```

  **Evidence to Capture**:
  - [ ] task-11-sidebar-render.txt
  - [ ] task-11-sidebar-navigate.txt

  **Commit**: YES
  - Message: `feat: implement sidebar connection list UI`
  - Files: src/ui/sidebar.ts

---

- [ ] 12. Connection Form (Add/Edit/Delete UI)

  **What to do**:
  - Implement `src/ui/connection-form.ts`:
    - `createConnectionForm(renderer: CliRenderer, existing?: ConnectionConfig): BoxRenderable`
    - Modal/dialog overlay with form fields:
      - **Name**: Input field (required)
      - **Host**: Input field (required, IP or hostname)
      - **Port**: Input field (default "22", numeric)
      - **Username**: Input field (required)
      - **Auth Type**: TabSelect or Select (Key / Password)
      - **Private Key Path**: Input field (shown when authType=key, default `~/.ssh/id_ed25519`)
      - **Password**: Input field with masking (shown when authType=password)
    - Use OpenTUI `Input` component for text fields
    - Use `TabSelect` or custom toggle for auth type
    - Buttons: "Save", "Cancel", "Delete" (if editing)
    - API:
      - `getFormData(): ConnectionConfig | null` — Return form data or null if invalid
      - `validate(): string[]` — Return list of validation errors
      - `onSubmit(callback: (data: ConnectionConfig) => void)`
      - `onCancel(callback: () => void)`
      - `onDelete(callback: (id: string) => void)` — Only if editing
      - `focus()` — Focus the first field
      - `destroy()` — Remove form from renderer
    - Validation:
      - Name cannot be empty
      - Host cannot be empty (basic format check)
      - Port must be 1-65535
      - Username cannot be empty
      - Password required if authType=password
      - Key path required if authType=key

  **Must NOT do**:
  - Do NOT implement storage operations (the parent app handles that)
  - Do NOT implement SSH connection testing

  **Recommended Agent Profile**:
  - **Category**: `visual-engineering`
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES (with 11, 13, 14)
  - **Parallel Group**: Wave 3 (with 11, 13, 14)
  - **Blocks**: 15
  - **Blocked By**: 2

  **References**:
  - OpenTUI Input: https://opentui.com/docs/components/input/
  - OpenTUI Select: https://opentui.com/docs/components/select/
  - OpenTUI TabSelect: https://opentui.com/docs/components/tab-select/

  **Acceptance Criteria**:

  **QA Scenarios (MANDATORY)**:

  ```
  Scenario: Connection form creates valid ConnectionConfig
    Tool: Bash (bun REPL)
    Preconditions: connection-form.ts exists
    Steps:
      1. Create form with existing connection data
      2. Call getFormData() and inspect result
    Expected Result: Returns ConnectionConfig with correct host, port, username, authType
    Failure Indicators: Missing fields, wrong types, returns null for valid data
    Evidence: .sisyphus/evidence/task-12-form-data.txt

  Scenario: Form validation catches empty required fields
    Tool: Bash (bun REPL)
    Preconditions: connection-form.ts exists
    Steps:
      1. Create form with empty name and host
      2. Call validate()
    Expected Result: Returns array of error messages including name and host errors
    Failure Indicators: Returns empty array (no validation), crashes, returns null
    Evidence: .sisyphus/evidence/task-12-form-validation.txt
  ```

  **Evidence to Capture**:
  - [ ] task-12-form-data.txt
  - [ ] task-12-form-validation.txt

  **Commit**: YES
  - Message: `feat: implement connection add/edit form UI`
  - Files: src/ui/connection-form.ts

---

- [ ] 13. Terminal Panel (OpenTUI Terminal Display)

  **What to do**:
  - Implement `src/ui/terminal-panel.ts`:
    - `createTerminalPanel(renderer: CliRenderer): BoxRenderable`
    - Main terminal display area:
      - `Box` with `flexGrow: 1`, dark background (`#0d1117`)
      - Contains the `TerminalRenderer` output (from Task 9)
      - ScrollBox for scrollable output
    - API:
      - `setTerminalRenderer(renderer: TerminalRenderer)` — Attach renderer
      - `focus()` — Focus the terminal panel for keyboard input
      - `showIdle()` — Show "Select a connection to begin" placeholder
      - `showConnecting(host: string)` — Show "Connecting to host..." state
      - `showConnected(host: string)` — Show connected indicator
      - `showError(message: string)` — Show error overlay
      - `showDisconnected()` — Show "Connection closed" state
      - `onKeyInput(callback: (key: string) => void)` — Forward keyboard events
    - Visual states:
      - Idle: Dark panel with centered text "← Select a connection to begin"
      - Connecting: "Connecting to {host}..." with spinner or dots animation
      - Connected: Empty terminal (buffer will fill with output)
      - Error: Red error message centered in panel
      - Disconnected: Yellow "Connection closed" message
    - The panel captures keyboard focus and forwards keystrokes to the SSH channel

  **Must NOT do**:
  - Do NOT implement SSH logic (separate bridge task)
  - Do NOT implement screen buffer logic (separate)

  **Recommended Agent Profile**:
  - **Category**: `visual-engineering`
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES (with 11, 12, 14)
  - **Parallel Group**: Wave 3 (with 11, 12, 14)
  - **Blocks**: 15
  - **Blocked By**: 9

  **References**:
  - OpenTUI ScrollBox: https://opentui.com/docs/components/scrollbox/
  - OpenTUI Box: https://opentui.com/docs/components/box/

  **Acceptance Criteria**:

  **QA Scenarios (MANDATORY)**:

  ```
  Scenario: Terminal panel shows idle state and can change to connecting state
    Tool: Bash (bun REPL) + programmatic renderer
    Preconditions: terminal-panel.ts exists
    Steps:
      1. Create terminal panel
      2. Call showIdle() — verify text content
      3. Call showConnecting('example.com') — verify text changed
    Expected Result: Idle shows placeholder text, connecting shows "Connecting to example.com"
    Failure Indicators: No text change, crashes, wrong text
    Evidence: .sisyphus/evidence/task-13-panel-states.txt

  Scenario: Keyboard events are forwarded through callback
    Tool: Bash (bun REPL)
    Preconditions: terminal-panel.ts exists
    Steps:
      1. Create terminal panel
      2. Register onKeyInput callback that records keys
      3. Simulate key input
    Expected Result: Callback receives the key sequence
    Failure Indicators: Callback not fired, wrong key data
    Evidence: .sisyphus/evidence/task-13-keyboard.txt
  ```

  **Evidence to Capture**:
  - [ ] task-13-panel-states.txt
  - [ ] task-13-keyboard.txt

  **Commit**: YES
  - Message: `feat: implement terminal panel UI`
  - Files: src/ui/terminal-panel.ts

---

- [ ] 14. Status Bar

  **What to do**:
  - Implement `src/ui/status-bar.ts`:
    - `createStatusBar(renderer: CliRenderer): BoxRenderable`
    - Bottom-aligned status bar showing:
      - Connection status (disconnected/connected to {host})
      - Keybinding hints (F1=Help, Ctrl+Q=Quit, etc.)
      - Current mode display
    - Fixed height: 1 row
    - Use `position: "absolute"`, `bottom: 0`, `width: "100%"`
    - Background: `#1f2937` (dark gray)
    - Left section: status text
    - Right section: keybinding hints
    - API:
      - `setStatus(text: string)` — Update left status
      - `setConnected(host: string)` — Show connected status
      - `setDisconnected()` — Show disconnected status
      - `setKeybindings(hints: string[])` — Update keybinding hints

  **Must NOT do**:
  - Do NOT add more than 1 row height
  - Do NOT add interactive elements (display only)

  **Recommended Agent Profile**:
  - **Category**: `visual-engineering`
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES (with 11, 12, 13)
  - **Parallel Group**: Wave 3 (with 11, 12, 13)
  - **Blocks**: 15
  - **Blocked By**: 2

  **References**:
  - OpenTUI Text component: https://opentui.com/docs/components/text/
  - OpenTUI Box styling (absolute positioning): https://opentui.com/docs/components/box/

  **Acceptance Criteria**:

  **QA Scenarios (MANDATORY)**:

  ```
  Scenario: Status bar renders with status text and keybinding hints
    Tool: Bash (bun REPL)
    Preconditions: status-bar.ts exists
    Steps:
      1. Create status bar
      2. Set status to "Connected to example.com"
      3. Set keybindings to ["Ctrl+Q: Quit"]
      4. Inspect renderable children
    Expected Result: Status bar has left text showing connection status and right text showing keybinding
    Failure Indicators: No text, wrong text, layout broken
    Evidence: .sisyphus/evidence/task-14-statusbar.txt
  ```

  **Evidence to Capture**:
  - [ ] task-14-statusbar.txt

  **Commit**: YES
  - Message: `feat: add status bar component`
  - Files: src/ui/status-bar.ts

---

- [ ] 15. Main App Layout + Focus Management + Keyboard Routing

  **What to do**:
  - Implement `src/app.ts`:
    - `App` class:
      - `constructor(renderer: CliRenderer)` — Initialize
      - `async init()` — Load connections, prompt for master password, build UI
      - `buildLayout()` — Create the main layout:
        ```
        ┌────────────────────────────────────────┐
        │  Title Bar (optional)                   │
        ├──────────┬─────────────────────────────┤
        │ Sidebar  │ Terminal Panel              │
        │ (flexGrow│ (flexGrow: 3)               │
        │ : 1)     │                             │
        │          │                             │
        ├──────────┴─────────────────────────────┤
        │  Status Bar                             │
        └────────────────────────────────────────┘
        ```
      - Layout uses `Box` with `flexDirection: "row"` for sidebar + terminal
      - `focusSidebar()` — Route keyboard to sidebar navigation
      - `focusTerminal()` — Route keyboard to SSH channel via terminal panel
      - `focusForm()` — Route keyboard to connection form
    - Focus zones:
      - **Global**: `Ctrl+Q` → quit app, `Ctrl+Tab` → toggle sidebar/terminal focus
      - **Sidebar focus**:
        - `Up/Down` → navigate list
        - `Enter` → connect to selected
        - `a` → add new connection (opens form)
        - `e` → edit selected connection (opens form)
        - `Delete` → delete selected connection (with confirmation)
      - **Terminal focus**:
        - ALL keystrokes forwarded to SSH channel via `terminalKeyHandler`
      - **Form focus**:
        - Standard form navigation (Tab between fields, Enter to save, Escape to cancel)
    - Master password prompt:
      - On startup, prompt for master password (simple Input on dark overlay)
      - If config file doesn't exist, prompt to create new master password
    - Wire connections:
      - Sidebar selection → terminal panel state changes
      - Connection form submit → save to store, refresh sidebar
      - Keyboard routing based on active focus zone
    - Lifecycle:
      - `destroy()` — Clean shutdown, disconnect SSH if active

  **Must NOT do**:
  - Do NOT add any features outside the MVP scope
  - Do NOT add mouse support (keyboard-only navigation)

  **Recommended Agent Profile**:
  - **Category**: `deep`
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: NO (depends on all prior tasks)
  - **Parallel Group**: Wave 4
  - **Blocks**: 16
  - **Blocked By**: 6, 7, 8, 9, 10, 11, 12, 13, 14

  **References**:
  - OpenTUI keyboard input: https://opentui.com/docs/core-concepts/keyboard/
  - OpenTUI focus management: Focus-based routing using `renderer.keyInput` events

  **Acceptance Criteria**:

  **QA Scenarios (MANDATORY)**:

  ```
  Scenario: App initializes and shows connection list
    Tool: Bash (bun REPL) + programmatic renderer
    Preconditions: All modules complete, test config file with 2 connections
    Steps:
      1. Create App with test renderer
      2. Call init()
      3. Inspect layout structure
    Expected Result: Layout has sidebar, terminal panel, and status bar
    Failure Indicators: Missing components, layout crash, initialization error
    Evidence: .sisyphus/evidence/task-15-app-init.txt

  Scenario: Keyboard routing switches between sidebar and terminal focus
    Tool: Bash (bun REPL) + programmatic key events
    Preconditions: App initialized
    Steps:
      1. Focus sidebar
      2. Emit Ctrl+Tab key event
      3. Check focus state changed to terminal
    Expected Result: Focus switches between sidebar and terminal zones
    Failure Indicators: Focus doesn't change, wrong zone activated, crash
    Evidence: .sisyphus/evidence/task-15-focus-routing.txt

  Scenario: Master password prompt appears on startup when encrypted config exists
    Tool: Bash (bun REPL)
    Preconditions: Encrypted config file exists
    Steps:
      1. Initialize App
      2. Verify password prompt overlay is shown
    Expected Result: Password prompt is visible, connections are not loaded until password entered
    Failure Indicators: App skips password prompt, crashes trying to decrypt, shows connections without password
    Evidence: .sisyphus/evidence/task-15-password-prompt.txt
  ```

  **Evidence to Capture**:
  - [ ] task-15-app-init.txt
  - [ ] task-15-focus-routing.txt
  - [ ] task-15-password-prompt.txt

  **Commit**: YES
  - Message: `feat: implement main app layout and focus management`
  - Files: src/app.ts

---

- [ ] 16. SSH ↔ Terminal Bridge + Entry Point Integration

  **What to do**:
  - Implement the bridge that connects SSH to the terminal display in `src/index.ts`:
    1. Create `CliRenderer` with `exitOnCtrlC: false` (we handle Ctrl+C ourselves)
    2. Initialize `App` with the renderer
    3. Start the render loop
    4. Wire SSH connection lifecycle:
       ```
       User selects connection → App calls sshConnection.connect(config)
         → connection.ready → sshConnection.startShell(80, 24)
         → Channel stream pipes to:
           [data event] → AnsiProcessor.process(data) → ScreenBuffer update
           → TerminalRenderer detects dirty → re-renders changed lines
         → TerminalPanel keyboard callback → sshChannel.write(key)
         → Terminal resize → sshConnection.resizePty(cols, rows)
       ```
    5. Handle SSH events:
       - `ready` → Update status bar, terminal panel to "connected"
       - `close` → Update status bar, terminal panel to "disconnected", re-enable sidebar
       - `error` → Show error in terminal panel, log to status bar
    6. Handle app lifecycle:
       - Window resize → debounced → screen buffer + PTY resize
       - Ctrl+C when not in terminal focus → app shutdown (call `renderer.destroy()`)
       - Clean disconnect when app closes
    7. Resize handling:
       - Listen to `process.stdout.on('resize', ...)` or OpenTUI's resize events
       - Debounce with 100ms timeout
       - Call `screenBuffer.resize(newRows, newCols)` and `sshConnection.resizePty(newRows, newCols)`

  **Must NOT do**:
  - Do NOT add Node.js fallback (Bun only for MVP)
  - Do NOT implement reconnection logic (manual reconnect only)

  **Recommended Agent Profile**:
  - **Category**: `deep`
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: NO (final integration task)
  - **Parallel Group**: Wave 4 (sequential after 15)
  - **Blocks**: F1-F4
  - **Blocked By**: 15

  **References**:
  - OpenTUI CliRenderer: https://opentui.com/docs/core-concepts/renderer/
  - ssh2 Channel API: https://github.com/mscdex/ssh2#channel

  **Acceptance Criteria**:

  **QA Scenarios (MANDATORY)**:

  ```
  Scenario: Full integration — app launches, connects, renders output
    Tool: Bash (bun REPL) + programmatic mock SSH server
    Preconditions: All modules complete, mock SSH server on localhost
    Steps:
      1. Start mock SSH server
      2. Create app with test connection pointing to mock server
      3. Simulate selecting connection and pressing Enter
      4. Verify terminal panel shows SSH shell output
    Expected Result: SSH connection established, terminal panel shows remote shell output
    Failure Indicators: Connection fails, no output rendered, crash on connect
    Evidence: .sisyphus/evidence/task-16-full-integration.txt

  Scenario: Resize handling works
    Tool: Bash (bun REPL)
    Preconditions: App running with active SSH connection
    Steps:
      1. Trigger resize event
      2. Verify screen buffer dimensions updated
      3. Verify PTY resize was called on SSH channel
    Expected Result: Both buffer and PTY are resized with correct dimensions, debounced properly
    Failure Indicators: No resize, wrong dimensions, multiple rapid resizes sent
    Evidence: .sisyphus/evidence/task-16-resize.txt

  Scenario: App exits cleanly on Ctrl+Q
    Tool: Bash (bun REPL)
    Preconditions: App running
    Steps:
      1. Press Ctrl+Q
      2. Verify renderer.destroy() was called
    Expected Result: App shuts down, terminal restored to normal
    Failure Indicators: App hangs, terminal left in raw mode, crash
    Evidence: .sisyphus/evidence/task-16-exit-clean.txt
  ```

  **Evidence to Capture**:
  - [ ] task-16-full-integration.txt
  - [ ] task-16-resize.txt
  - [ ] task-16-exit-clean.txt

  **Commit**: YES
  - Message: `feat: integrate SSH ↔ terminal bridge and entry point`
  - Files: src/index.ts

---

## Final Verification Wave

> 4 review agents run in PARALLEL. ALL must APPROVE. Present consolidated results to user and get explicit "okay" before completing.

- [ ] F1. **Plan Compliance Audit** — `oracle`
  Read the plan end-to-end. For each "Must Have": verify implementation exists (read file, curl endpoint, run command). For each "Must NOT Have": search codebase for forbidden patterns — reject with file:line if found. Check evidence files exist in .sisyphus/evidence/. Compare deliverables against plan.
  Output: `Must Have [N/N] | Must NOT Have [N/N] | Tasks [N/N] | VERDICT: APPROVE/REJECT`

- [ ] F2. **Code Quality Review** — `unspecified-high`
  Run `bun run src/index.ts --validate` + linter. Review all changed files for: `as any`/`@ts-ignore`, empty catches, console.log in prod, commented-out code, unused imports. Check AI slop: excessive comments, over-abstraction, generic names (data/result/item/temp).
  Output: `Build [PASS/FAIL] | Lint [PASS/FAIL] | Files [N clean/N issues] | VERDICT`

- [ ] F3. **Real Manual QA** — `unspecified-high`
  Start from clean state. Execute EVERY QA scenario from EVERY task — follow exact steps, capture evidence. Test cross-task integration (features working together). Test edge cases: invalid input, connection failure, corrupted config.
  Output: `Scenarios [N/N pass] | Integration [N/N] | Edge Cases [N tested] | VERDICT`

- [ ] F4. **Scope Fidelity Check** — `deep`
  For each task: read "What to do", read actual diff. Verify 1:1 — everything in spec was built (no missing), nothing beyond spec was built (no creep). Check "Must NOT do" compliance. Detect cross-task contamination.
  Output: `Tasks [N/N compliant] | Contamination [CLEAN/N issues] | Unaccounted [CLEAN/N files] | VERDICT`

---

## Commit Strategy

| Task(s) | Message | Scope |
|---------|---------|-------|
| 1 | `chore: scaffold project with Bun + OpenTUI deps` | package.json, tsconfig.json, .gitignore |
| 2 | `feat: add type definitions for connections and terminal` | src/types/* |
| 3 | `feat: implement terminal screen buffer with 2D cell grid` | src/terminal/cell.ts, screen-buffer.ts |
| 4 | `feat: add AES-256-GCM encryption module` | src/storage/encryption.ts |
| 5 | `feat: add config storage path initialization` | src/storage/config.ts |
| 6 | `feat: implement ANSI parser integration with screen buffer` | src/terminal/ansi-processor.ts |
| 7 | `feat: add SSH connection module with ssh2` | src/ssh/connection.ts |
| 8 | `feat: add authentication module (key + password)` | src/ssh/auth.ts |
| 9 | `feat: implement terminal renderer (buffer → OpenTUI)` | src/terminal/terminal-renderer.ts |
| 10 | `feat: add connections CRUD with encrypted storage` | src/storage/connections.ts |
| 11 | `feat: implement sidebar connection list UI` | src/ui/sidebar.ts |
| 12 | `feat: implement connection add/edit form UI` | src/ui/connection-form.ts |
| 13 | `feat: implement terminal panel UI` | src/ui/terminal-panel.ts |
| 14 | `feat: add status bar component` | src/ui/status-bar.ts |
| 15 | `feat: implement main app layout and focus management` | src/app.ts |
| 16 | `feat: integrate SSH ↔ terminal bridge and entry point` | src/index.ts |

---

## Success Criteria

### Final Verification
```bash
bun run src/index.ts
# Expected: TUI launches showing connection list (empty state) + terminal panel (idle)
```

### Connection Management
```bash
# Add connection via UI → connection appears in list
# Edit connection → changes saved
# Delete connection → removed from list and file
# Restart app → connections loaded from encrypted file with master password
```

### SSH Connection
```bash
# Select connection, press Enter → terminal panel shows SSH shell
# Type commands → output appears with correct colors
# Ctrl+C → forwarded to remote (not app exit)
# Window resize → terminal re-flows correctly
# Disconnect → error message shown, return to connection list
```

### Final Checklist
- [ ] All "Must Have" present
- [ ] All "Must NOT Have" absent
- [ ] All QA scenarios pass
- [ ] Evidence files exist in `.sisyphus/evidence/`
