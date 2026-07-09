import type { CliRenderer } from '@opentui/core';

export interface StatusBarAPI {
  setStatus(text: string): void;
  setConnected(host: string): void;
  setDisconnected(): void;
  setKeybindings(hints: string[]): void;
}

/**
 * Status bar disabled — returns a no-op API.
 * All calls are silently ignored so existing code doesn't break.
 */
export function createStatusBar(_renderer: CliRenderer): StatusBarAPI {
  return {
    setStatus(_text: string): void {},
    setConnected(_host: string): void {},
    setDisconnected(): void {},
    setKeybindings(_hints: string[]): void {},
  };
}
