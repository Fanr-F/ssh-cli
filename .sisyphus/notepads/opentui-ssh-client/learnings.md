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
