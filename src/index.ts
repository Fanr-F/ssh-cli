import { createCliRenderer, type CliRenderer } from '@opentui/core';
import { App } from './app';
import { parseLogLevel, setupLogger } from './logger';

// Parse --log-level from CLI args (e.g. bun run start -- --log-level debug)
const { level: logLevel, warning } = parseLogLevel(process.argv.slice(2));
if (warning) console.warn(warning);

await setupLogger({ level: logLevel });

let renderer: CliRenderer | null = null;
try {
  renderer = await createCliRenderer({
    exitOnCtrlC: false,
    exitSignals: [],
    useMouse: true,
  });

  const app = new App(renderer);
  await app.init();
} catch (err) {
  console.error(
    'Failed to start ssh-cli:',
    err instanceof Error ? err.message : String(err),
  );
  // Never leave the terminal stuck in the alternate screen or mouse mode.
  if (renderer) {
    try {
      renderer.destroy();
      await renderer.closed;
    } catch {
      // Best effort: we are already on the failure path.
    }
  }
  process.exit(1);
}
