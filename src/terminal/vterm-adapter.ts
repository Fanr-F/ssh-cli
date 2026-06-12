import { StyledText } from '@opentui/core';
import { createVtermScreen, type VtermScreen, type ScreenCell } from 'vterm.js';
import { appendFileSync } from 'fs';

const IO_LOG = 'ssh-cli-io.log';
function logIo(msg: string) {
  try { appendFileSync(IO_LOG, `[${new Date().toISOString()}] ${msg}\n`); } catch {}
}

/** Convert vterm { r, g, b } to "#RRGGBB" hex string for OpenTUI parseColor. */
function colorToHex(c: { r: number; g: number; b: number } | null): string | undefined {
  if (!c) return undefined;
  return `#${c.r.toString(16).padStart(2, '0')}${c.g.toString(16).padStart(2, '0')}${c.b.toString(16).padStart(2, '0')}`;
}

/** Bright ANSI 16-color palette — replaces dim defaults */
const BRIGHT_PALETTE: Record<number, string> = {
  0: '#000000',   // Black (keep dark)
  1: '#FF5555',   // Red (bright)
  2: '#50FA7B',   // Green (bright)
  3: '#F1FA8C',   // Yellow (bright)
  4: '#6272A4',   // Blue (muted blue-gray, easier on eyes)
  5: '#FF79C6',   // Magenta (bright)
  6: '#8BE9FD',   // Cyan (bright)
  7: '#BFBFBF',   // White (bright gray)
  8: '#4D4D4D',   // Bright Black (dark gray)
  9: '#FF6E6E',   // Bright Red
  10: '#69FF94',  // Bright Green
  11: '#FFFFA5',  // Bright Yellow
  12: '#D6ACFF',  // Bright Blue (lavender)
  13: '#FF92DF',  // Bright Magenta
  14: '#A4FFFF',  // Bright Cyan
  15: '#FFFFFF',  // Bright White
};

export class VtermAdapter {
  private screen: VtermScreen;
  private _cols: number;
  private _rows: number;

  constructor(cols: number, rows: number, onResponse?: (data: string) => void) {
    this._cols = cols;
    this._rows = rows;
    this.screen = createVtermScreen({ cols, rows, scrollbackLimit: 5000, onResponse });
    this.applyBrightPalette();
  }

  /** Remap ANSI 16-color palette to brighter colors via OSC 4 sequences. */
  private applyBrightPalette(): void {
    for (const [index, hex] of Object.entries(BRIGHT_PALETTE)) {
      // OSC 4;N;#RRGGBB\ — set palette color index N
      const seq = `\x1b]4;${index};${hex}\x1b\\`;
      this.screen.process(new TextEncoder().encode(seq));
    }
  }

  feed(data: Uint8Array | string): void {
    if (typeof data === 'string') {
      this.screen.process(new TextEncoder().encode(data));
    } else {
      this.screen.process(data);
    }
  }

  /** Resize the terminal. */
  resize(cols: number, rows: number): void {
    this._cols = cols;
    this._rows = rows;
    this.screen.resize(cols, rows);
  }

  /** Get terminal dimensions. */
  get cols(): number { return this._cols; }
  get rows(): number { return this._rows; }

  /** Get cursor position { x, y }. */
  getCursorPosition(): { x: number; y: number } {
    return this.screen.getCursorPosition();
  }

  /** Check if cursor is visible. */
  isCursorVisible(): boolean {
    return this.screen.getCursorVisible();
  }

  /** Get cursor shape. */
  getCursorShape(): 'block' | 'underline' | 'bar' {
    return this.screen.getCursorShape();
  }

  /**
   * Get all visible lines as StyledText arrays.
   * Returns an array of StyledText, one per row.
   */
  getStyledLines(): StyledText[] {
    const lines: StyledText[] = [];
    for (let row = 0; row < this._rows; row++) {
      lines.push(this.getStyledLine(row));
    }
    return lines;
  }

  /**
   * Get a single row as StyledText.
   */
  getStyledLine(row: number): StyledText {
    const cells = this.screen.getLine(row);
    return this.cellsToStyledText(cells);
  }

  /**
   * Convert vterm.js ScreenCell array to OpenTUI StyledText.
   * Groups consecutive cells with the same styling into chunks.
   *
   * IMPORTANT: fg/bg must be hex strings ("#RRGGBB"), NOT RGBA objects.
   * OpenTUI's StyledChunkStruct.mapValue() calls normalizeColorValue()
   * → parseColor() internally to convert strings to RGBA.
   */
  private cellsToStyledText(cells: ScreenCell[]): StyledText {
    const chunks: Array<{
      __isChunk: true;
      text: string;
      fg?: string;
      bg?: string;
      attributes: number;
    }> = [];

    // Track current chunk's text and styling for merging
    let currentText = '';
    let currentFg: string | undefined;
    let currentBg: string | undefined;

    const flushChunk = () => {
      if (currentText.length > 0) {
        chunks.push({
          __isChunk: true,
          text: currentText,
          fg: currentFg,
          bg: currentBg,
          attributes: 0,
        });
      }
    };

    // Collect unique color pairs for this row (for logging)
    const colorPairs = new Set<string>();

    for (let i = 0; i < cells.length; i++) {
      const cell = cells[i];

      // Skip hidden characters
      if (cell.hidden) {
        continue;
      }

      // Convert { r, g, b } to "#RRGGBB" hex string
      let fgHex = colorToHex(cell.fg);
      let bgHex = colorToHex(cell.bg);

      // Handle inverse
      if (cell.inverse) {
        const tmp = fgHex;
        fgHex = bgHex;
        bgHex = tmp;
      }

      const char = cell.char || ' ';

      // Track unique color pairs (not spaces — those are usually default)
      if (char !== ' ' && (fgHex || bgHex)) {
        colorPairs.add(`fg=${fgHex || 'default'} bg=${bgHex || 'default'}`);
      }

      // Merge with previous chunk if styling matches
      if (currentFg === fgHex && currentBg === bgHex) {
        currentText += char;
      } else {
        // Flush previous chunk and start new one
        flushChunk();
        currentText = char;
        currentFg = fgHex;
        currentBg = bgHex;
      }
    }

    // Flush final chunk
    flushChunk();

    // Log unique color pairs for this row (only if non-default colors present)
    if (colorPairs.size > 0) {
      logIo(`COLORS: ${[...colorPairs].join(' | ')}`);
    }

    return new StyledText(chunks);
  }

  /**
   * Get plain text for a row (for debugging).
   */
  getLineText(row: number): string {
    return this.screen.getLine(row).map(c => c.char).join('');
  }

  /** Reset the terminal. */
  reset(): void {
    this.screen.reset();
  }
}
