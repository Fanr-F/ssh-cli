/**
 * Capture README effect images by rendering the real App headlessly with
 * OpenTUI's test renderer and rasterizing the captured frame (cells + colors)
 * to SVG under docs/assets/.
 *
 * Usage: bun run scripts/capture-screenshots.ts
 *
 * Demo state is fully in-memory: no SSH connections are made, no real config
 * files or keychain entries are touched (the screenshots use a throwaway
 * local directory for the SFTP panel and a fake SFTP client).
 */
import { createTestRenderer } from '@opentui/core/testing';
import { rm, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { writeFileSync, mkdirSync } from 'node:fs';
import { App } from '../src/app';
import { createTerminalRenderable } from '../src/app/terminal-tab';
import { createAltScreenTracker } from '../src/ssh/alt-screen';
import { createSftpTab } from '../src/sftp/sftp-tab';
import type { ConnectionConfig } from '../src/types/connection';
import type { CapturedFrame, CapturedSpan } from '@opentui/core';

const WIDTH = 128;
const HEIGHT = 36;
const OUT_DIR = 'docs/assets';
const ABS_OUT_DIR = join(process.cwd(), OUT_DIR);

// ── HTML/XML helpers ──────────────────────────────────────────────────────

function escapeXml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function hex(rgba: { toInts(): [number, number, number, number] }): { hex: string; a: number } {
  const [r, g, b, a] = rgba.toInts();
  const h = (v: number) => Math.round(v).toString(16).padStart(2, '0');
  return { hex: `#${h(r)}${h(g)}${h(b)}`, a };
}

// ── Frame → SVG rasterizer ────────────────────────────────────────────────

const CELL_W = 9;
const CELL_H = 20;
const FONT_SIZE = 15;
const CANVAS = '#16161e';
const BORDER = '#3b4261';

const ATTR_BOLD = 1 << 0;
const ATTR_DIM = 1 << 1;
const ATTR_ITALIC = 1 << 2;
const ATTR_UNDERLINE = 1 << 3;
const ATTR_INVERSE = 1 << 5;
const ATTR_HIDDEN = 1 << 6;
const ATTR_STRIKETHROUGH = 1 << 7;

function isWideCodePoint(cp: number): boolean {
  return (
    (cp >= 0x1100 && cp <= 0x115f) ||
    (cp >= 0x2e80 && cp <= 0xa4cf) ||
    (cp >= 0xa960 && cp <= 0xa97f) ||
    (cp >= 0xac00 && cp <= 0xd7af) ||
    (cp >= 0xf900 && cp <= 0xfaff) ||
    (cp >= 0xfe30 && cp <= 0xfe4f) ||
    (cp >= 0xff00 && cp <= 0xff60) ||
    (cp >= 0xffe0 && cp <= 0xffe6) ||
    (cp >= 0x20000 && cp <= 0x3fffd)
  );
}

function renderSpan(span: CapturedSpan, row: number, col: number): string {
  const inverse = (span.attributes & ATTR_INVERSE) !== 0;
  const fgSrc = inverse ? span.bg : span.fg;
  const bgSrc = inverse ? span.fg : span.bg;
  const fg = hex(fgSrc);
  const bg = hex(bgSrc);

  const x = (col * CELL_W).toFixed(2);
  const y = row * CELL_H;
  const w = span.width * CELL_W;
  const parts: string[] = [];

  if (bg.a > 0 && bg.hex.toLowerCase() !== CANVAS) {
    parts.push(
      `<rect x="${x}" y="${y}" width="${w.toFixed(2)}" height="${CELL_H}" fill="${bg.hex}"/>`,
    );
  }

  // Position every glyph at its own cell instead of stretching the span, so
  // the output is independent of the viewer's monospace font metrics.
  if ((span.attributes & ATTR_HIDDEN) === 0) {
    const attrs: string[] = [`y="${(y + 15).toFixed(1)}"`, `font-size="${FONT_SIZE}"`, `fill="${fg.hex}"`];
    if ((span.attributes & ATTR_BOLD) !== 0) attrs.push('font-weight="700"');
    if ((span.attributes & ATTR_ITALIC) !== 0) attrs.push('font-style="italic"');
    const decor: string[] = [];
    if ((span.attributes & ATTR_UNDERLINE) !== 0) decor.push('underline');
    if ((span.attributes & ATTR_STRIKETHROUGH) !== 0) decor.push('line-through');
    if (decor.length > 0) attrs.push(`text-decoration="${decor.join(' ')}"`);
    if ((span.attributes & ATTR_DIM) !== 0) attrs.push('opacity="0.6"');
    const attrStr = attrs.join(' ');

    let offset = 0;
    for (const ch of span.text) {
      const cp = ch.codePointAt(0)!;
      const cw = isWideCodePoint(cp) ? 2 : 1;
      if (ch.trim().length > 0) {
        const gx = ((col + offset) * CELL_W).toFixed(2);
        parts.push(`<text x="${gx}" ${attrStr}>${escapeXml(ch)}</text>`);
      }
      offset += cw;
    }
  }

  return parts.join('');
}

function frameToSvg(frame: CapturedFrame): string {
  const w = frame.cols * CELL_W;
  const h = frame.rows * CELL_H;
  const body: string[] = [];

  for (let row = 0; row < frame.lines.length; row++) {
    let col = 0;
    for (const span of frame.lines[row].spans) {
      body.push(renderSpan(span, row, col));
      col += span.width;
    }
  }

  // No cursor overlay: the native terminal reports its cursor in a coordinate
  // space that does not map linearly to screen cells.

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${w + 2}" height="${h + 2}" viewBox="0 0 ${w + 2} ${h + 2}">
  <defs>
    <clipPath id="clip"><rect x="1" y="1" width="${w}" height="${h}" rx="10"/></clipPath>
  </defs>
  <rect x="1" y="1" width="${w}" height="${h}" rx="10" fill="${CANVAS}" stroke="${BORDER}" stroke-width="1.5"/>
  <g clip-path="url(#clip)" font-family="'Cascadia Mono','JetBrains Mono',Consolas,Menlo,'DejaVu Sans Mono',monospace">
${body.join('\n')}
  </g>
</svg>
`;
}

// ── Demo data ─────────────────────────────────────────────────────────────

const DEMO_CONNECTIONS: ConnectionConfig[] = [
  { id: 'demo-web', name: 'web-prod-01', host: '192.168.1.101', port: 22, username: 'root', authType: 'key', keyPath: '~/.ssh/id_rsa', createdAt: '2026-08-02T09:00:00.000Z', lastConnectedAt: '2026-11-04T09:41:00.000Z' },
  { id: 'demo-db', name: 'db-primary', host: '10.0.8.24', port: 22, username: 'postgres', authType: 'password', createdAt: '2026-08-02T09:00:00.000Z', lastConnectedAt: '2026-11-03T22:14:00.000Z' },
  { id: 'demo-k8s', name: 'k8s-node-03', host: '10.0.8.37', port: 22, username: 'ubuntu', authType: 'key', keyPath: '~/.ssh/id_rsa', createdAt: '2026-09-12T09:00:00.000Z', lastConnectedAt: '2026-11-02T18:03:00.000Z' },
  { id: 'demo-dev', name: 'dev-box', host: '192.168.1.50', port: 2222, username: 'fanr', authType: 'key', keyPath: '~/.ssh/id_ed25519', createdAt: '2026-09-20T09:00:00.000Z' },
  { id: 'demo-nas', name: 'backup-nas', host: '192.168.1.200', port: 22, username: 'admin', authType: 'password', createdAt: '2026-10-01T09:00:00.000Z' },
];

const PROMPT = '\x1b[32mroot@web-prod-01\x1b[0m:\x1b[34m~\x1b[0m# ';

const DEMO_SESSION = [
  `${PROMPT}uptime`,
  ` 09:41:23 up 132 days, 4:17,  2 users,  load average: 0.18, 0.24, 0.31`,
  `${PROMPT}free -h`,
  `               total        used        free      shared  buff/cache   available`,
  `Mem:           7.7Gi       2.3Gi       3.9Gi        88Mi       1.5Gi       5.0Gi`,
  `Swap:          2.0Gi          0B       2.0Gi`,
  `${PROMPT}df -h /`,
  `Filesystem      Size  Used Avail Use% Mounted on`,
  `/dev/sda1        96G   42G   50G  46% /`,
  `${PROMPT}systemctl is-active nginx`,
  `\x1b[32mactive\x1b[0m`,
  `${PROMPT}docker ps`,
  `NAMES             STATUS          PORTS`,
  `web              \x1b[32mUp 132 days\x1b[0m     0.0.0.0:80->80/tcp`,
  `cache            \x1b[32mUp 132 days\x1b[0m     6379/tcp`,
  `postgres         \x1b[32mUp 9 days\x1b[0m        5432/tcp`,
  PROMPT,
].join('\r\n');

const mtime = (iso: string) => Math.floor(new Date(iso).getTime() / 1000);

const REMOTE_ITEMS = [
  { name: 'backups', isDirectory: true, isFile: false, isSymlink: false, size: 4096, mode: 0o40755, mtime: mtime('2026-11-04T03:00:00Z'), longname: '' },
  { name: 'deploy', isDirectory: true, isFile: false, isSymlink: false, size: 4096, mode: 0o40755, mtime: mtime('2026-11-04T08:12:00Z'), longname: '' },
  { name: 'logs', isDirectory: true, isFile: false, isSymlink: false, size: 4096, mode: 0o40755, mtime: mtime('2026-11-04T09:40:00Z'), longname: '' },
  { name: 'nginx', isDirectory: true, isFile: false, isSymlink: false, size: 4096, mode: 0o40755, mtime: mtime('2026-10-28T11:00:00Z'), longname: '' },
  { name: 'docker-compose.yml', isDirectory: false, isFile: true, isSymlink: false, size: 2381, mode: 0o100644, mtime: mtime('2026-11-01T15:44:00Z'), longname: '' },
  { name: 'app-2026.11.04.tar.gz', isDirectory: false, isFile: true, isSymlink: false, size: 84_934_145, mode: 0o100644, mtime: mtime('2026-11-04T08:05:00Z'), longname: '' },
  { name: '.bashrc', isDirectory: false, isFile: true, isSymlink: false, size: 3526, mode: 0o100644, mtime: mtime('2026-06-14T10:00:00Z'), longname: '' },
  { name: '.profile', isDirectory: false, isFile: true, isSymlink: false, size: 807, mode: 0o100644, mtime: mtime('2026-06-14T10:00:00Z'), longname: '' },
];

async function createLocalDemoDir(): Promise<string> {
  // A short absolute path inside the repo keeps the panel header on one line;
  // the directory is deleted when the script finishes.
  const dir = join(process.cwd(), '.screenshot-demo');
  await rm(dir, { recursive: true, force: true });
  await mkdir(join(dir, 'src'), { recursive: true });
  await mkdir(join(dir, 'docs'), { recursive: true });
  await mkdir(join(dir, 'assets'), { recursive: true });
  await mkdir(join(dir, 'dist'), { recursive: true });
  await writeFile(join(dir, 'package.json'), Buffer.alloc(2214, 32));
  await writeFile(join(dir, 'bun.lock'), Buffer.alloc(88_420, 32));
  await writeFile(join(dir, 'README.md'), Buffer.alloc(19_860, 32));
  await writeFile(join(dir, 'release-notes.md'), Buffer.alloc(6_144, 32));
  await writeFile(join(dir, 'tsconfig.json'), Buffer.alloc(512, 32));
  return dir;
}

// ── App fixture ───────────────────────────────────────────────────────────

function mockSsh() {
  return {
    isConnected: () => true,
    getLastError: () => null,
    disconnect: async () => {},
    writeToShell: () => {},
    resizePty: () => {},
  } as any;
}

interface Fixture {
  app: any;
  ssh: ReturnType<typeof mockSsh>;
  term: ReturnType<typeof createTerminalRenderable>;
  tabId: string;
}

function buildApp(app: App) {
  (app as any).connections = DEMO_CONNECTIONS;
  (app as any).buildLayout();
}

function addDemoTerminalTab(t: any, app: App): Fixture {
  const tabId = 'tab-demo';
  const renderer = t.renderer as any;
  const cols = Math.max(40, WIDTH - 32);
  const rows = Math.max(10, HEIGHT - 5);
  const ssh = mockSsh();
  const term = createTerminalRenderable({
    renderer,
    tabId,
    cols,
    rows,
    ssh,
    onRightClickPaste: () => {},
  });
  (app as any).terminalPanel.registerTerminal(tabId, term);
  (app as any).tabs.set(tabId, {
    term,
    ssh,
    config: DEMO_CONNECTIONS[0],
    altScreen: createAltScreenTracker(),
  });
  (app as any).tabBar.addTab(tabId, 'SSH: root@web-prod-01', 'terminal');
  return { app: app as any, ssh, term, tabId };
}

async function shotTerminal(): Promise<string> {
  const t = await createTestRenderer({ width: WIDTH, height: HEIGHT });
  const app = new App(t.renderer as any);
  try {
    buildApp(app);
    const { term, tabId } = addDemoTerminalTab(t, app);
    term.write(DEMO_SESSION);
    (app as any).tabBar.switchTo(tabId);
    (app as any).terminalPanel.switchTerminal(tabId);
    (app as any).terminalPanel.showConnected('192.168.1.101');
    (app as any).statusBar.setConnected('192.168.1.101');
    (app as any).focusTerminal();
    await t.renderOnce();
    await t.renderOnce();
    const frame = t.captureSpans();
    return frameToSvg(frame);
  } finally {
    await (app as any).clipboard?.dispose?.();
    await t.dispose();
  }
}

async function shotSftp(localPwd: string): Promise<string> {
  const t = await createTestRenderer({ width: WIDTH, height: HEIGHT });
  const app = new App(t.renderer as any);
  try {
    buildApp(app);
    const { term, tabId } = addDemoTerminalTab(t, app);
    term.write(DEMO_SESSION);
    (app as any).tabBar.switchTo(tabId);
    (app as any).terminalPanel.switchTerminal(tabId);
    (app as any).statusBar.setConnected('192.168.1.101');

    const remoteClient = {
      realpath: async () => '/root',
      readdir: async () => REMOTE_ITEMS,
      stat: async () => {
        throw new Error('ENOENT');
      },
      close: () => {},
    };
    const sftpTabId = 'sftp-demo';
    const sftpTab = createSftpTab(
      sftpTabId,
      t.renderer as any,
      remoteClient as any,
      '~',
      localPwd,
      () => {},
    );
    const sftpSsh = mockSsh();
    (app as any).tabs.set(sftpTabId, {
      term,
      ssh: sftpSsh,
      config: DEMO_CONNECTIONS[0],
      altScreen: createAltScreenTracker(),
      sftpClient: remoteClient,
      sftpTab,
    });
    (app as any).tabBar.addTab(sftpTabId, 'SFTP: root@web-prod-01', 'sftp');
    (app as any).switchToTab(sftpTabId);
    (app as any).statusBar.setStatus('SFTP connected to 192.168.1.101', 'success');
    await sftpTab.refresh();
    await t.renderOnce();
    await t.renderOnce();
    const frame = t.captureSpans();
    return frameToSvg(frame);
  } finally {
    await (app as any).clipboard?.dispose?.();
    await t.dispose();
  }
}

async function main() {
  mkdirSync(ABS_OUT_DIR, { recursive: true });
  const dir = await createLocalDemoDir();
  try {
    const terminal = await shotTerminal();
    writeFileSync(join(ABS_OUT_DIR, 'screenshot-terminal.svg'), terminal, 'utf-8');
    console.log('wrote', join(ABS_OUT_DIR, 'screenshot-terminal.svg'));

    const sftp = await shotSftp(dir);
    writeFileSync(join(ABS_OUT_DIR, 'screenshot-sftp.svg'), sftp, 'utf-8');
    console.log('wrote', join(ABS_OUT_DIR, 'screenshot-sftp.svg'));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

void main();
