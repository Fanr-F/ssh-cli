import { describe, expect, test } from 'bun:test';
import { createTestRenderer } from '@opentui/core/testing';
import { createConnectionForm, type FormAPI } from '../../src/ui/connection-form';
import type { ConnectionConfig } from '../../src/types/connection';

const existing: ConnectionConfig = {
  id: 'c1',
  name: 'Prod',
  host: 'example.com',
  port: 2222,
  username: 'root',
  authType: 'key',
  privateKeyPath: '~/.ssh/id_ed25519',
  createdAt: '2026-01-01T00:00:00.000Z',
};

function key(name: string, sequence: string) {
  return {
    name,
    sequence,
    ctrl: false,
    shift: false,
    meta: false,
    option: false,
    preventDefault: () => {},
  } as any;
}

function press(form: FormAPI, name: string, sequence = '') {
  form.handleKey(key(name, sequence));
}

/** Tab moves to the next field; buttons come after 0-3 + auth(4) + conditional(5) + save(6). */
function tabTo(form: FormAPI, field: number) {
  for (let i = 0; i < field; i += 1) press(form, 'tab', '\t');
  expect(form.getFocusedFieldIndex()).toBe(field);
}

describe('connection form keyboard semantics', () => {
  test('Enter on Cancel cancels instead of saving', async () => {
    const t = await createTestRenderer({ width: 100, height: 30 });
    const form = createConnectionForm(t.renderer, existing);
    let submits = 0;
    let cancels = 0;
    form.onSubmit(() => { submits += 1; });
    form.onCancel(() => { cancels += 1; });

    try {
      form.focus();
      tabTo(form, 7);
      press(form, 'enter', '\r');
      await t.renderOnce();

      expect(cancels).toBe(1);
      expect(submits).toBe(0);
    } finally {
      form.destroy();
      await t.dispose();
    }
  });

  test('Enter on Delete deletes instead of saving', async () => {
    const t = await createTestRenderer({ width: 100, height: 30 });
    const form = createConnectionForm(t.renderer, existing);
    const deleted: string[] = [];
    let submits = 0;
    form.onSubmit(() => { submits += 1; });
    form.onDelete((id) => { deleted.push(id); });

    try {
      form.focus();
      tabTo(form, 8);
      press(form, 'enter', '\r');
      await Promise.resolve();
      await t.renderOnce();

      expect(deleted).toEqual(['c1']);
      expect(submits).toBe(0);
    } finally {
      form.destroy();
      await t.dispose();
    }
  });

  test('Enter on Save submits a valid form', async () => {
    const t = await createTestRenderer({ width: 100, height: 30 });
    const form = createConnectionForm(t.renderer, existing);
    const submitted: ConnectionConfig[] = [];
    form.onSubmit((data) => { submitted.push(data); });

    try {
      form.focus();
      tabTo(form, 6);
      press(form, 'enter', '\r');
      await t.renderOnce();

      expect(submitted).toHaveLength(1);
      expect(submitted[0]?.id).toBe('c1');
      expect(submitted[0]?.port).toBe(2222);
    } finally {
      form.destroy();
      await t.dispose();
    }
  });

  test('invalid submit shows the first validation error', async () => {
    const t = await createTestRenderer({ width: 100, height: 30 });
    const form = createConnectionForm(t.renderer);
    let submits = 0;
    form.onSubmit(() => { submits += 1; });

    try {
      form.focus();
      press(form, 'enter', '\r');
      await t.renderOnce();

      expect(submits).toBe(0);
      expect(t.captureCharFrame()).toContain('Name is required');
    } finally {
      form.destroy();
      await t.dispose();
    }
  });
});
