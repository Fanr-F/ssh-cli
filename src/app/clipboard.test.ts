import { describe, expect, test } from 'bun:test';
import { ClipboardController, normalizePasteText, type ClipboardPasteTarget } from './clipboard';
import type { StatusKind } from '../ui/status-bar';

function makeController(options: {
  writeResult?: any;
  readResult?: any;
  target?: ClipboardPasteTarget;
}) {
  const statuses: Array<{ text: string; kind: StatusKind }> = [];
  let renders = 0;
  const clipboard = {
    writeText: async () => options.writeResult ?? null,
    read: async () => options.readResult ?? null,
    dispose: async () => {},
  } as any;
  const controller = new ClipboardController(clipboard, {
    setStatus: (text, kind) => statuses.push({ text, kind }),
    requestRender: () => { renders += 1; },
    getPasteTarget: () => options.target ?? { kind: 'none' },
  });
  return { controller, statuses, renders: () => renders };
}

describe('clipboard controller', () => {
  test('normalises CRLF and strips trailing newlines', () => {
    expect(normalizePasteText(new TextEncoder().encode('a\r\nb\rc\n\n'))).toBe('a\nb\nc');
  });

  test('reports a successful copy', async () => {
    const { controller, statuses } = makeController({
      writeResult: {
        host: { status: 'written' },
        terminal: { status: 'attempted', capability: 'osc52' },
      },
    });
    await controller.copy('hello');
    expect(statuses).toEqual([{ text: 'Copied to clipboard', kind: 'success' }]);
  });

  test('reports a failed copy', async () => {
    const { controller, statuses } = makeController({ writeResult: null });
    await controller.copy('hello');
    expect(statuses).toEqual([{ text: 'Copy failed', kind: 'error' }]);
  });

  test('does not touch the clipboard for empty text', async () => {
    const { controller, statuses } = makeController({});
    await controller.copy('');
    expect(statuses).toEqual([]);
  });

  test('pastes normalised text into the terminal target', async () => {
    const written: string[] = [];
    const target: ClipboardPasteTarget = {
      kind: 'terminal',
      term: { encodePaste: (bytes) => bytes },
      ssh: {
        isConnected: () => true,
        writeToShell: (data) => written.push(data),
      },
    };
    const { controller, statuses } = makeController({
      readResult: {
        status: 'read',
        representation: { bytes: new TextEncoder().encode('a\r\nb\n') },
      },
      target,
    });

    await controller.paste();
    expect(written).toEqual(['a\nb']);
    expect(statuses).toEqual([{ text: 'Pasted to terminal', kind: 'success' }]);
  });

  test('warns when the terminal is not connected', () => {
    const { controller, statuses } = makeController({
      target: {
        kind: 'terminal',
        term: { encodePaste: (bytes) => bytes },
        ssh: { isConnected: () => false, writeToShell: () => {} },
      },
    });
    controller.pasteText('x');
    expect(statuses).toEqual([{ text: 'Not connected', kind: 'warning' }]);
  });

  test('reports unsupported/empty/timed-out reads', async () => {
    for (const [status, expected] of [
      ['empty', { text: 'Clipboard is empty', kind: 'warning' }],
      ['unsupported', { text: 'Clipboard unsupported', kind: 'error' }],
      ['timed-out', { text: 'Clipboard read timed out', kind: 'error' }],
    ] as const) {
      const { controller, statuses } = makeController({ readResult: { status } });
      await controller.paste();
      expect(statuses).toEqual([expected]);
    }
  });

  test('reports when there is no paste target', () => {
    const { controller, statuses } = makeController({});
    controller.pasteText('x');
    expect(statuses).toEqual([{ text: 'Nothing to paste to', kind: 'warning' }]);
  });
});
