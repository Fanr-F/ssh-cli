import type { KeyEvent } from '@opentui/core';
import type { KeyPattern, NormalizedKey } from './types';

/**
 * 传统终端把 Alt+方向键编码成 xterm 序列，且不设置 meta 标志。
 * 这是唯一的终端差异兜底表；以后适配新终端只改这里。
 */
const ALT_SEQUENCES: Record<string, string> = {
  '\x1b[1;3A': 'up',
  '\x1b[1;3B': 'down',
  '\x1b[1;3C': 'right',
  '\x1b[1;3D': 'left',
};

const KEY_NAMES: Record<string, string> = {
  tab: 'Tab',
  escape: 'Esc',
  esc: 'Esc',
  enter: 'Enter',
  return: 'Enter',
  backspace: 'Backspace',
  delete: 'Delete',
  space: 'Space',
  up: '↑',
  down: '↓',
  left: '←',
  right: '→',
  home: 'Home',
  end: 'End',
  pageup: 'PageUp',
  pagedown: 'PageDown',
  insert: 'Insert',
};

/** 把 OpenTUI 的原始事件归一化成稳定的按键描述。 */
export function normalizeKey(key: KeyEvent): NormalizedKey {
  const sequence = key.sequence ?? '';
  const meta = !!(key.meta || key.option);

  const altName = ALT_SEQUENCES[sequence];
  if (!meta && altName) {
    return { name: altName, ctrl: false, shift: false, meta: true, sequence, printable: false };
  }

  return {
    name: key.name,
    ctrl: !!key.ctrl,
    shift: !!key.shift,
    meta,
    sequence,
    printable: !key.ctrl && !meta && sequence.length === 1 && sequence >= ' ',
  };
}

/** 单个模式是否匹配。未声明的修饰键表示「不关心」。 */
export function matchesPattern(key: NormalizedKey, pattern: KeyPattern): boolean {
  if (pattern.any) return true;
  if (pattern.name !== undefined && pattern.name !== key.name) return false;
  if (pattern.ctrl !== undefined && pattern.ctrl !== key.ctrl) return false;
  if (pattern.shift !== undefined && pattern.shift !== key.shift) return false;
  if (pattern.meta !== undefined && pattern.meta !== key.meta) return false;
  return true;
}

/** 一个绑定可以声明多个等价键。 */
export function matchesKey(key: NormalizedKey, patterns: KeyPattern | KeyPattern[]): boolean {
  const list = Array.isArray(patterns) ? patterns : [patterns];
  return list.some((pattern) => matchesPattern(key, pattern));
}

/** 把模式格式化成文档里显示的键名。 */
export function formatPattern(pattern: KeyPattern): string {
  if (pattern.any) return 'Any key';

  const parts: string[] = [];
  if (pattern.ctrl) parts.push('Ctrl');
  if (pattern.shift) parts.push('Shift');
  if (pattern.meta) parts.push('Alt');

  const name = pattern.name ?? '';
  let label = KEY_NAMES[name];
  if (!label) {
    label = name.length === 1 ? name.toUpperCase() : name.charAt(0).toUpperCase() + name.slice(1);
  }
  parts.push(label);
  return parts.join('+');
}

/** 绑定在文档里的键名列；`override` 优先。 */
export function formatKeys(
  patterns: KeyPattern | KeyPattern[],
  override?: string,
): string {
  if (override) return override;
  const list = Array.isArray(patterns) ? patterns : [patterns];
  // enter / return 是同一个键的两种名字，显示时去重
  return [...new Set(list.map(formatPattern))].join(' / ');
}
