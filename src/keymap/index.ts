export * from './types';
export { normalizeKey, matchesKey, matchesPattern, formatKeys, formatPattern } from './matcher';
export { BINDINGS, MANUAL_ENTRIES, bindingsForScope, findBinding } from './bindings';

import { BINDINGS, MANUAL_ENTRIES } from './bindings';
import { formatKeys } from './matcher';
import { GROUP_NOTES, GROUP_ORDER, GROUP_TITLES, type Binding, type Group } from './types';

export interface DocRow {
  keys: string;
  text: string;
}

export interface DocGroup {
  group: Group;
  title: string;
  note?: string;
  rows: DocRow[];
}

/**
 * 生成帮助弹窗 / README 使用的分组文档。
 * 内部按键（help 自己的滚动与关闭）只在弹窗底部提示，不进表格。
 */
export function buildDocs(lang: 'en' | 'zh'): DocGroup[] {
  const documented = BINDINGS.filter((b: Binding) => b.scope !== 'help');
  const groups: DocGroup[] = [];

  for (const group of GROUP_ORDER) {
    const rows: DocRow[] = [];

    for (const binding of documented) {
      if (binding.group !== group) continue;
      rows.push({
        keys: formatKeys(binding.key, binding.keys),
        text: lang === 'zh' ? binding.zh : binding.en,
      });
    }

    for (const entry of MANUAL_ENTRIES) {
      if (entry.group !== group) continue;
      const keys = lang === 'zh' ? (entry.keysZh ?? entry.keys) : entry.keys;
      rows.push({ keys, text: lang === 'zh' ? entry.zh : entry.en });
    }

    if (rows.length === 0) continue;
    groups.push({
      group,
      title: GROUP_TITLES[group][lang],
      note: GROUP_NOTES[group]?.[lang],
      rows,
    });
  }

  return groups;
}
