import type { ClipboardService } from '@opentui/core';
import { logDebug } from '../logger';
import type { StatusKind } from '../ui/status-bar';

/** One of the places that can receive pasted text. */
export type ClipboardPasteTarget =
  | {
      kind: 'terminal';
      term: { encodePaste(input: Uint8Array): Uint8Array };
      ssh: { isConnected(): boolean; writeToShell(data: string): void };
    }
  | { kind: 'form'; form: { pasteText(text: string): void } }
  | { kind: 'sftp'; tab: { pasteText(text: string): void } }
  | { kind: 'none' };

export interface ClipboardHooks {
  setStatus(text: string, kind: StatusKind): void;
  requestRender(): void;
  /** Resolve the current focus target at paste time. */
  getPasteTarget(): ClipboardPasteTarget;
}

/**
 * Normalise clipboard text for a remote shell: CRLF/CR become LF and trailing
 * newlines are dropped so paste does not execute immediately.
 */
export function normalizePasteText(bytes: Uint8Array): string {
  return new TextDecoder()
    .decode(bytes)
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .replace(/\n+$/, '');
}

function isCopySuccessful(
  result: Awaited<ReturnType<ClipboardService['writeText']>> | null,
): boolean {
  return !!result && (result.host.status === 'written' || result.terminal.status === 'attempted');
}

/**
 * Clipboard facade shared by terminal, form and SFTP tabs.
 *
 * Copy has one entry point (text selection in the renderer); paste is
 * right-click driven and resolves its destination from the current focus.
 */
export class ClipboardController {
  constructor(
    private readonly clipboard: ClipboardService,
    private readonly hooks: ClipboardHooks,
  ) {}

  async copy(text: string): Promise<void> {
    if (!text) return;
    logDebug(`[COPY] copying ${text.length} chars`);
    const result = await this.clipboard
      .writeText(text, {
        destination: 'all-available',
        selection: 'clipboard',
        // Local bindings must always be attempted, even before terminal
        // capability probing finishes.
        allowRemoteHost: true,
      })
      .catch((err) => {
        logDebug(`[COPY] writeText failed: ${err}`);
        return null;
      });

    if (result) {
      logDebug(
        `[COPY] writeText: host=${result.host.status}, terminal=${result.terminal.status}/${result.terminal.capability}`,
      );
    }
    const ok = isCopySuccessful(result);
    this.report(ok ? 'Copied to clipboard' : 'Copy failed', ok ? 'success' : 'error');
  }

  async paste(): Promise<void> {
    const result = await this.clipboard
      .read({ preferredTypes: ['text/plain'], selection: 'clipboard' })
      .catch((err) => {
        logDebug(`[PASTE] clipboard read failed: ${err}`);
        return null;
      });

    if (!result) {
      this.report('Clipboard read failed', 'error');
      return;
    }

    if (result.status !== 'read') {
      logDebug(`[PASTE] clipboard read status: ${result.status}`);
      this.report(readFailureMessage(result.status), readFailureKind(result.status));
      return;
    }

    const text = normalizePasteText(result.representation.bytes);
    if (!text) {
      this.report('Clipboard is empty', 'warning');
      return;
    }

    this.pasteText(text);
    this.hooks.requestRender();
  }

  /** Insert already-normalised text into the current focus target. */
  pasteText(text: string): void {
    const target = this.hooks.getPasteTarget();
    switch (target.kind) {
      case 'terminal':
        if (target.ssh.isConnected()) {
          const encoded = target.term.encodePaste(new TextEncoder().encode(text));
          target.ssh.writeToShell(Buffer.from(encoded).toString('utf8'));
          this.report('Pasted to terminal', 'success');
        } else {
          this.report('Not connected', 'warning');
        }
        break;
      case 'form':
        target.form.pasteText(text);
        this.report('Pasted to form', 'success');
        break;
      case 'sftp':
        target.tab.pasteText(text);
        this.report('Pasted to SFTP', 'success');
        break;
      case 'none':
        this.report('Nothing to paste to', 'warning');
        break;
    }
  }

  /** Show a status message and request a redraw; used by every paste branch. */
  private report(text: string, kind: StatusKind): void {
    this.hooks.setStatus(text, kind);
    this.hooks.requestRender();
  }

  dispose(): Promise<void> {
    return this.clipboard.dispose();
  }
}

function readFailureMessage(status: string): string {
  if (status === 'empty') return 'Clipboard is empty';
  if (status === 'unsupported') return 'Clipboard unsupported';
  if (status === 'timed-out') return 'Clipboard read timed out';
  return 'Clipboard read failed';
}

function readFailureKind(status: string): StatusKind {
  return status === 'empty' ? 'warning' : 'error';
}
