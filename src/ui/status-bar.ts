import { Box, Text } from '@opentui/core';
import type { CliRenderer } from '@opentui/core';
import { theme } from '../theme';
import { resolveNode, type ResolvedNode } from './resolve';

export type StatusKind = 'info' | 'success' | 'warning' | 'error';

export interface StatusBarAPI {
  readonly component: ReturnType<typeof Box>;
  setStatus(text: string, kind?: StatusKind): void;
  setConnected(host: string): void;
  setDisconnected(): void;
}

const C = {
  bg: theme.appBg,
  info: theme.cyan,
  success: theme.green,
  warning: theme.yellow,
  error: theme.red,
  dim: theme.textDim,
};

const KIND_COLORS: Record<StatusKind, string> = {
  info: C.info,
  success: C.success,
  warning: C.warning,
  error: C.error,
};

const AUTO_CLEAR_MS = 6000;

/**
 * One-line status bar for operation results, errors, and connection state.
 *
 * Errors stay until the next status update; info/success messages clear
 * automatically so focus changes do not leave stale text forever.
 */
export function createStatusBar(renderer: CliRenderer): StatusBarAPI {
  const text = Text({ id: 'status-bar-text', content: ' Ready', fg: C.dim });
  const box = Box(
    {
      id: 'status-bar',
      width: '100%',
      height: 1,
      flexShrink: 0,
      backgroundColor: C.bg,
      paddingX: 1,
    },
    text,
  );

  let resolvedText: ResolvedNode | null = null;
  let clearTimer: ReturnType<typeof setTimeout> | null = null;

  function getText(): ResolvedNode | null {
    if (!resolvedText) {
      resolvedText = resolveNode(renderer, 'status-bar-text');
    }
    return resolvedText;
  }

  function cancelClear(): void {
    if (clearTimer) {
      clearTimeout(clearTimer);
      clearTimer = null;
    }
  }

  function setStatus(value: string, kind: StatusKind = 'info'): void {
    const node = getText();
    if (!node) return;

    cancelClear();
    node.content = ` ${value}`;
    node.fg = KIND_COLORS[kind];

    if (kind !== 'error') {
      clearTimer = setTimeout(() => {
        clearTimer = null;
        const current = getText();
        if (!current) return;
        current.content = ' Ready';
        current.fg = C.dim;
        renderer.requestRender();
      }, AUTO_CLEAR_MS);
      // Do not keep the process alive just for a status message.
      (clearTimer as { unref?: () => void }).unref?.();
    }

    renderer.requestRender();
  }

  return {
    component: box,

    setStatus,

    setConnected(host: string): void {
      setStatus(`Connected to ${host}`, 'success');
    },

    setDisconnected(): void {
      setStatus('Connection closed', 'warning');
    },
  };
}
