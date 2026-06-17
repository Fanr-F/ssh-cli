import { StyledText } from '@opentui/core';
import { createVtermScreen, type VtermScreen, type ScreenCell } from 'vterm.js';
import { createLogger } from '../logger';

const log = createLogger('terminal');

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

/**
 * Helper: compare two ScreenCell arrays for equality (by char + fg + bg).
 */
function cellsEqual(a: ScreenCell[], b: ScreenCell[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i].char !== b[i].char) return false;
    const aFg = a[i].fg, bFg = b[i].fg;
    const aBg = a[i].bg, bBg = b[i].bg;
    if ((aFg?.r ?? -1) !== (bFg?.r ?? -1) || (aFg?.g ?? -1) !== (bFg?.g ?? -1) || (aFg?.b ?? -1) !== (bFg?.b ?? -1)) return false;
    if ((aBg?.r ?? -1) !== (bBg?.r ?? -1) || (aBg?.g ?? -1) !== (bBg?.g ?? -1) || (aBg?.b ?? -1) !== (bBg?.b ?? -1)) return false;
  }
  return true;
}

export class VtermAdapter {
  private screen: VtermScreen;
  private _cols: number;
  private _rows: number;

  // ── Custom scrollback buffer ────────────────────────────────────
  // vterm.js getLine() only reads the visible grid (not scrollback).
  // We maintain our own scrollback buffer by capturing lines before they scroll off.
  private _scrollbackBuffer: ScreenCell[][] = [];
  private _scrollbackLimit: number;
  private _prevTopLine: ScreenCell[] = [];
  private _prevScreen: ScreenCell[][] = [];

  constructor(cols: number, rows: number, onResponse?: (data: string) => void) {
    this._cols = cols;
    this._rows = rows;
    this._scrollbackLimit = 5000;
    this.screen = createVtermScreen({ cols, rows, scrollbackLimit: this._scrollbackLimit, onResponse });
    this._scrollbackBuffer = [];
    this.applyBrightPalette();
    this.captureScreen();
  }

  /** Capture the current screen state for scrollback tracking. */
  private captureScreen(): void {
    this._prevTopLine = this.screen.getLine(0).map(c => ({ ...c }));
    this._prevScreen = [];
    for (let i = 0; i < this._rows; i++) {
      this._prevScreen.push(this.screen.getLine(i).map(c => ({ ...c })));
    }
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
    try {
      // Save screen state before feed for scrollback detection
      this.captureScreen();

      if (typeof data === 'string') {
        this.screen.process(new TextEncoder().encode(data));
      } else {
        this.screen.process(data);
      }

      // Detect scrolled lines and add to our scrollback buffer
      this.detectScrolledLines();
    } catch (err) {
      log.error({ error: err }, 'Failed to feed data to vterm');
    }
  }

  /**
   * Detect lines that scrolled off the top and add them to scrollback buffer.
   * Compares the screen state before and after feed to find scrolled lines.
   */
  private detectScrolledLines(): void {
    const newTopLine = this.screen.getLine(0).map(c => ({ ...c }));
    
    // If top line changed, lines have scrolled
    if (!cellsEqual(this._prevTopLine, newTopLine)) {
      // Find how many lines scrolled by comparing old screen with new screen
      let scrolledCount = 0;
      
      // Simple heuristic: check how many of the old screen's top lines are gone
      // The old line 0 is definitely gone if it's not in the new screen
      if (!this.lineExistsInScreen(this._prevTopLine)) {
        scrolledCount = 1;
        
        // Check if more lines scrolled (old line 1 is now gone, etc.)
        for (let i = 1; i < this._prevScreen.length; i++) {
          if (!this.lineExistsInScreen(this._prevScreen[i])) {
            scrolledCount = i + 1;
          } else {
            break;
          }
        }
      }
      
      // Add scrolled lines to our buffer (oldest first)
      for (let i = 0; i < scrolledCount && i < this._prevScreen.length; i++) {
        this._scrollbackBuffer.push(this._prevScreen[i]);
      }
      
      // Trim buffer if too large
      while (this._scrollbackBuffer.length > this._scrollbackLimit) {
        this._scrollbackBuffer.shift();
      }
      
      if (scrolledCount > 0) {
        log.debug({ scrolledCount, bufferSize: this._scrollbackBuffer.length }, 'Scrollback captured lines');
      }
    }
    
    // Update prev screen state
    this.captureScreen();
  }

  /** Check if a line exists anywhere in the current visible screen. */
  private lineExistsInScreen(line: ScreenCell[]): boolean {
    for (let i = 0; i < this._rows; i++) {
      const screenLine = this.screen.getLine(i);
      if (cellsEqual(line, screenLine)) return true;
    }
    return false;
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

  // ── Scrollback ────────────────────────────────────────────────────

  /** Number of scrollback lines available. */
  getScrollbackLength(): number {
    return this._scrollbackBuffer.length;
  }

  /** Current viewport scroll offset (0 = at bottom). */
  getViewportOffset(): number {
    return this.screen.getViewportOffset();
  }

  /** Scroll the viewport. Positive = up (older), negative = down (newer). */
  scrollViewport(delta: number): void {
    const before = this.screen.getViewportOffset();
    const scrollback = this._scrollbackBuffer.length;
    log.debug(`SCROLL_VIEWPORT: delta=${delta}, before=${before}, scrollback=${scrollback}`);
    
    // Clamp delta to valid range
    const maxOffset = this._scrollbackBuffer.length;
    const newOffset = Math.max(0, Math.min(maxOffset, before + delta));
    const actualDelta = newOffset - before;
    
    // Use vterm.js scrollViewport (even though getLine doesn't use it, we track offset ourselves)
    this.screen.scrollViewport(actualDelta);
    
    const after = this.screen.getViewportOffset();
    log.debug(`SCROLL_VIEWPORT: after=${after}, actualDelta=${actualDelta}`);
  }

  /** Scroll to bottom (viewport offset = 0). */
  scrollToBottom(): void {
    const offset = this.screen.getViewportOffset();
    if (offset > 0) {
      this.screen.scrollViewport(-offset);
      log.debug(`SCROLL_TO_BOTTOM: was at offset=${offset}`);
    }
  }

  /** Check if viewport is at the bottom. */
  isAtBottom(): boolean {
    return this.screen.getViewportOffset() === 0;
  }



  /**
   * Get all visible lines as StyledText arrays.
   * Returns an array of StyledText, one per row.
   * 
   * When viewport is offset (scrolled up), reads from our custom scrollback buffer
   * for older content, and from vterm.js grid for newer content.
   */
  getStyledLines(): StyledText[] {
    const lines: StyledText[] = [];
    const viewportOffset = this.screen.getViewportOffset();
    const scrollbackSize = this._scrollbackBuffer.length;
    log.debug(`GET_STYLED_LINES: rows=${this._rows}, scrollback=${scrollbackSize}, viewportOffset=${viewportOffset}`);
    
    for (let row = 0; row < this._rows; row++) {
      // Calculate which line to show at this display row
      // viewportOffset=0 means bottom of scrollback (newest)
      // Higher viewportOffset means further back in history
      
      const scrollbackIndex = scrollbackSize - viewportOffset + row;
      
      let cells: ScreenCell[];
      if (scrollbackIndex >= 0 && scrollbackIndex < scrollbackSize) {
        // Read from our custom scrollback buffer
        cells = this._scrollbackBuffer[scrollbackIndex];
        if (row < 3) {
          const firstChars = cells.slice(0, 20).map(c => c.char).join('');
          log.debug(`GET_STYLED_LINES row=${row}: from scrollback[${scrollbackIndex}], content="${firstChars}"`);
        }
      } else {
        // Read from vterm.js visible grid
        const gridRow = scrollbackIndex - scrollbackSize;
        cells = this.screen.getLine(gridRow);
        if (row < 3) {
          const firstChars = cells.slice(0, 20).map(c => c.char).join('');
          log.debug(`GET_STYLED_LINES row=${row}: from grid[${gridRow}], content="${firstChars}"`);
        }
      }
      
      lines.push(this.cellsToStyledText(cells));
    }
    return lines;
  }

  /**
   * Get a single row as StyledText.
   * Note: row is viewport-relative (0 = top of visible area)
   */
  getStyledLine(row: number): StyledText {
    const viewportOffset = this.screen.getViewportOffset();
    const scrollbackSize = this._scrollbackBuffer.length;
    const scrollbackIndex = scrollbackSize - viewportOffset + row;
    
    let cells: ScreenCell[];
    if (scrollbackIndex >= 0 && scrollbackIndex < scrollbackSize) {
      cells = this._scrollbackBuffer[scrollbackIndex];
    } else {
      const gridRow = scrollbackIndex - scrollbackSize;
      cells = this.screen.getLine(gridRow);
    }
    
    // Log first few calls for debugging
    if (row < 3) {
      const firstChars = cells.slice(0, 20).map(c => c.char).join('');
      log.debug(`GET_LINE row=${row}: scrollbackIdx=${scrollbackIndex}, first20="${firstChars}"`);
    }
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
      log.debug(`COLORS: ${[...colorPairs].join(' | ')}`);
    }

    return new StyledText(chunks);
  }

  /**
   * Get plain text for a row (for debugging).
   * Note: row is viewport-relative
   */
  getLineText(row: number): string {
    const viewportOffset = this.screen.getViewportOffset();
    const scrollbackSize = this._scrollbackBuffer.length;
    const scrollbackIndex = scrollbackSize - viewportOffset + row;
    
    let cells: ScreenCell[];
    if (scrollbackIndex >= 0 && scrollbackIndex < scrollbackSize) {
      cells = this._scrollbackBuffer[scrollbackIndex];
    } else {
      const gridRow = scrollbackIndex - scrollbackSize;
      cells = this.screen.getLine(gridRow);
    }
    
    return cells.map(c => c.char).join('');
  }

  /** Reset the terminal. */
  reset(): void {
    this.screen.reset();
    this._scrollbackBuffer = [];
  }
}
