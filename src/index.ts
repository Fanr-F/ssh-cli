import { createCliRenderer } from '@opentui/core';
import { App } from './app';

const renderer = await createCliRenderer({
  exitOnCtrlC: false,
  useMouse: true,
});

const app = new App(renderer);
await app.init();
