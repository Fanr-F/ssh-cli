import { createCliRenderer } from '@opentui/core';
import { App } from './app';
import { setupLogger, type LogLevel } from './logger';

// Parse --log-level from CLI args (e.g. bun run start -- --log-level debug)
const args = process.argv.slice(2);
const logLevelIdx = args.indexOf('--log-level');
const logLevel: LogLevel = (logLevelIdx !== -1 && args[logLevelIdx + 1]) as LogLevel || 'info';

await setupLogger({ level: logLevel });

const renderer = await createCliRenderer({
  exitOnCtrlC: false,
  exitSignals: [],
  useMouse: true,
});

const app = new App(renderer);
await app.init();
