/**
 * Platform-aware clipboard utility for Bun TUI apps.
 *
 * Copy: platform-specific commands (clip.exe / pbcopy / xclip / wl-copy)
 * Paste: platform-specific commands (PowerShell Get-Clipboard / pbpaste / xclip / wl-paste)
 */

import { spawn } from 'bun';

// ─── Copy ──────────────────────────────────────────────────────

export async function copyToClipboard(text: string): Promise<boolean> {
  const input = Buffer.from(text, 'utf-8');
  const platform = process.platform;

  try {
    if (platform === 'darwin') {
      const proc = await spawn(['pbcopy'], { stdin: input }).exited;
      return proc === 0;
    }

    if (platform === 'win32') {
      // CRITICAL: pipe via stdin — Bun.spawn strips $ in -Command strings on Windows
      const proc = await spawn(
        [
          'powershell.exe',
          '-NoProfile',
          '-Command',
          '[Console]::InputEncoding = [System.Text.Encoding]::UTF8; Set-Clipboard -Value ([Console]::In.ReadToEnd())',
        ],
        { stdin: input, stdout: 'ignore', stderr: 'ignore' },
      ).exited;
      return proc === 0;
    }

    // Linux
    const isWayland = !!process.env.WAYLAND_DISPLAY;
    if (isWayland && (await Bun.which('wl-copy'))) {
      // wl-copy must stay alive — do NOT await
      spawn(['wl-copy', '--type', 'text/plain'], {
        stdin: input,
        stdout: 'ignore',
        stderr: 'ignore',
      }).unref();
      return true;
    }
    if (await Bun.which('xclip')) {
      const proc = await spawn(['xclip', '-selection', 'clipboard'], { stdin: input }).exited;
      return proc === 0;
    }
    if (await Bun.which('xsel')) {
      const proc = await spawn(['xsel', '--clipboard', '--input'], { stdin: input }).exited;
      return proc === 0;
    }

    return false;
  } catch {
    return false;
  }
}

// ─── Paste ─────────────────────────────────────────────────────

export async function pasteFromClipboard(): Promise<string> {
  const platform = process.platform;

  if (platform === 'darwin') {
    const proc = spawn(['pbpaste']);
    const buf = await new Response(proc.stdout).arrayBuffer();
    return Buffer.from(buf).toString('utf-8');
  }

  if (platform === 'win32') {
    const proc = spawn([
      'powershell.exe',
      '-NoProfile',
      '-Command',
      'Get-Clipboard -Raw',
    ]);
    const buf = await new Response(proc.stdout).arrayBuffer();
    return Buffer.from(buf).toString('utf-8').trimEnd();
  }

  // Linux
  const isWayland = !!process.env.WAYLAND_DISPLAY;
  let cmd: string[];
  if (isWayland && (await Bun.which('wl-paste'))) {
    cmd = ['wl-paste', '--type', 'text/plain', '--no-newline'];
  } else if (await Bun.which('xclip')) {
    cmd = ['xclip', '-selection', 'clipboard', '-t', 'text/plain', '-out'];
  } else if (await Bun.which('xsel')) {
    cmd = ['xsel', '--clipboard', '--output'];
  } else {
    throw new Error('No clipboard tool found (install xclip, xsel, or wl-clipboard)');
  }

  const proc = spawn(cmd);
  const buf = await new Response(proc.stdout).arrayBuffer();
  return Buffer.from(buf).toString('utf-8');
}
