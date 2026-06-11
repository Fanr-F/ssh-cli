import { createCliRenderer } from '@opentui/core';
import { App } from './app';

const renderer = await createCliRenderer({
  exitOnCtrlC: false,
  exitSignals: [], // Disable SIGINT/SIGBREAK so Ctrl+C reaches our keypress handler
  useMouse: true,
});

const app = new App(renderer);
await app.init();
