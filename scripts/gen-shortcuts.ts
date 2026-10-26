/**
 * 从 src/keymap/bindings.ts 生成 README 里的快捷键表格。
 *
 *   bun run docs          # 更新 README.md / README.zh.md
 *   bun run docs --print  # 只打印，不写文件
 *
 * 文档不再手写：改键位只改绑定表，然后跑这个脚本。
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildDocs } from '../src/keymap/index';

const ROOT = join(import.meta.dir, '..');
const BEGIN = '<!-- shortcuts:begin -->';
const END = '<!-- shortcuts:end -->';

const TEXT = {
  en: {
    heading: '### Keyboard Shortcuts',
    mouseHeading: '### Mouse Shortcuts',
    key: 'Key',
    action: 'Action',
    command: 'Command',
    desc: 'Description',
  },
  zh: {
    heading: '### 快捷键',
    mouseHeading: '### 鼠标快捷键',
    key: '按键',
    action: '操作',
    command: '命令',
    desc: '说明',
  },
} as const;

type Lang = keyof typeof TEXT;

function cell(value: string): string {
  return value.replace(/\|/g, '\\|');
}

function renderBlock(lang: Lang): string {
  const docs = buildDocs(lang);
  const t = TEXT[lang];
  const lines: string[] = [BEGIN, '', t.heading, ''];

  for (const group of docs) {
    if (group.group === 'mouse') continue;

    lines.push(`#### ${group.title}`, '');

    if (group.note) lines.push(`> ${group.note}`, '');

    if (group.group === 'sftp-command') {
      lines.push(`| ${t.command} | ${t.desc} |`, '|---|---|');
      for (const row of group.rows) {
        lines.push(`| \`${cell(row.keys)}\` | ${cell(row.text)} |`);
      }
    } else {
      lines.push(`| ${t.key} | ${t.action} |`, '|---|---|');
      for (const row of group.rows) {
        lines.push(`| \`${cell(row.keys)}\` | ${cell(row.text)} |`);
      }
    }

    lines.push('');
  }

  const mouse = docs.find((group) => group.group === 'mouse');
  if (mouse) {
    lines.push(t.mouseHeading, '');
    lines.push(`| ${t.action} | ${t.desc} |`, '|---|---|');
    for (const row of mouse.rows) {
      lines.push(`| ${cell(row.keys)} | ${cell(row.text)} |`);
    }
    lines.push('');
  }

  lines.push(END);
  return lines.join('\n');
}

const printOnly = process.argv.includes('--print');
let failed = false;

for (const [lang, file] of [
  ['en', 'README.md'],
  ['zh', 'README.zh.md'],
] as Array<[Lang, string]>) {
  const block = renderBlock(lang);

  if (printOnly) {
    console.log(`\n───── ${file} ─────\n`);
    console.log(block);
    continue;
  }

  const path = join(ROOT, file);
  const source = readFileSync(path, 'utf8');
  const start = source.indexOf(BEGIN);
  const end = source.indexOf(END);

  if (start === -1 || end === -1) {
    console.error(`[docs] ${file}: missing shortcuts markers (${BEGIN} ... ${END})`);
    failed = true;
    continue;
  }

  const next = source.slice(0, start) + block + source.slice(end + END.length);
  writeFileSync(path, next, 'utf8');
  console.log(`[docs] updated ${file}`);
}

if (failed) process.exitCode = 1;
