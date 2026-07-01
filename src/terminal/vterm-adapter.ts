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

/**
 * Helper: compare two ScreenCell arrays by character only (ignore fg/bg).
 * Used for scrollback matching where color changes shouldn't prevent line matching.
 */
function cellsCharEqual(a: ScreenCell[], b: ScreenCell[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i].char !== b[i].char) return false;
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
  private _prevCursorY: number = 0;
  private _updateCount = 0;
  private _generation = 0;

  // ── Viewport offset tracking ────────────────────────────────────
  // We track viewport offset ourselves because vterm.js's scrollback length
  // can diverge from our _scrollbackBuffer.length after resize captures.
  // vterm.js clamps scrollViewport to its own scrollback, making old entries
  // in our buffer unreachable if we rely on vterm.js's offset.
  private _viewportOffset: number = 0;

  constructor(cols: number, rows: number, onResponse?: (data: string) => void) {
    this._cols = cols;
    this._rows = rows;
    this._scrollbackLimit = 5000;
    this.screen = createVtermScreen({ cols, rows, scrollbackLimit: this._scrollbackLimit, onResponse });
    this._scrollbackBuffer = [];
    this.applyBrightPalette();
    this.captureScreen();
  }

  get generation(): number { return this._generation; }

  /** Capture the current screen state for scrollback tracking. */
  private captureScreen(): void {
    this._prevTopLine = this.screen.getLine(0).map(c => ({ ...c }));
    this._prevCursorY = this.screen.getCursorPosition().y;
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

      // Log raw data when debug enabled — helps diagnose scrollback false positives
      const text = typeof data === 'string' ? data : new TextDecoder().decode(data);
      if (text.length <= 200) {
        const topText = this.screen.getLine(0).map(c => c.char).join('').trimEnd();
        const bottomText = this.screen.getLine(this._rows - 1).map(c => c.char).join('').trimEnd();
        const cursor = this.screen.getCursorPosition();
        log.debug({ data: text.replace(/\x1b/g, '\\e').replace(/\r/g, '\\r').replace(/\n/g, '\\n'), top: topText, bottom: bottomText, cursorY: cursor.y, sb: this._scrollbackBuffer.length }, 'FEED');
      }

      // Detect scrolled lines and add to our scrollback buffer
      this.detectScrolledLines();
      this._generation++;
    } catch (err) {
      log.error({ error: err }, 'Failed to feed data to vterm');
    }
  }

  /**
   * Detect lines that scrolled off the top and add them to scrollback buffer.
   *
   * Scroll detection algorithm:
   * 1. Verify the old bottom line no longer exists at the bottom position (confirms shift, not in-place edit)
   * 2. Verify the top line changed by TEXT content (not just color changes)
   * 3. Find the first old line that still exists in the new screen (lines above it scrolled off)
   *
   * This prevents false positives from:
   * - Typing at prompt (top line text unchanged → Guard 2 filters)
   * - Arrow key / tab completion (top line text unchanged → Guard 2 filters)
   * - Shell redraws with color changes (top line text unchanged → Guard 2 filters)
   * - In-place edits on the bottom row (old bottom still exists → Guard 1 filters)
   */
  private detectScrolledLines(): void {
    // Guard 0: skip detection on first connection (no previous screen to compare)
    if (this._prevScreen.length === 0) {
      return;
    }

    // Guard 1: scrolling can ONLY happen when the cursor is at the last row.
    // Use CURRENT cursor position (post-processing) to catch large data chunks
    // that fill remaining rows and scroll in one feed() call.
    // Typing at prompt leaves cursor at same row → still blocked.
    if (this.screen.getCursorPosition().y < this._rows - 1) {
      return;
    }

    // Guard 2: the old bottom line must NOT still be at the bottom position.
    // If it is, content changed in-place (typing on last row, color redraw) — no scroll happened.
    const oldBottomLine = this._prevScreen[this._rows - 1];
    const newBottomLine = this.screen.getLine(this._rows - 1);
    const bottomStillSame = !this.isBlankLine(oldBottomLine) && cellsCharEqual(oldBottomLine, newBottomLine);

    // Guard 3: the top line must have changed by TEXT content.
    // If text is the same (only colors changed), no scroll happened.
    const newTopLine = this.screen.getLine(0).map(c => ({ ...c }));
    const topStillSame = cellsCharEqual(this._prevTopLine, newTopLine);

    // Debug: log guard results when top changed (potential scroll)
    if (!topStillSame) {
      const oldTopText = this._prevTopLine.map(c => c.char).join('').trimEnd();
      const newTopText = newTopLine.map(c => c.char).join('').trimEnd();
      const oldBottomText = oldBottomLine.map(c => c.char).join('').trimEnd();
      const newBottomText = newBottomLine.map(c => c.char).join('').trimEnd();
      log.debug({
        topChanged: true,
        bottomSame: bottomStillSame,
        oldTop: oldTopText,
        newTop: newTopText,
        oldBottom: oldBottomText,
        newBottom: newBottomText,
        cursorY: this._prevCursorY,
        rows: this._rows,
      }, 'SCROLL_DETECT: top line changed');
    }

    if (bottomStillSame) {
      return;
    }

    if (topStillSame) {
      return;
    }
    
    // Top line changed and old bottom line shifted — this is a real scroll.
    // Find the first old screen line that still exists in the new screen.
    // Lines before this position have scrolled off and should be captured.
    // Blank lines are skipped — they match anywhere and cause false positives.
    let firstRemaining = -1;
    for (let i = 0; i < this._prevScreen.length; i++) {
      if (!this.isBlankLine(this._prevScreen[i]) && this.lineExistsInScreen(this._prevScreen[i])) {
        firstRemaining = i;
        break;
      }
    }
    
    const scrolledCount = firstRemaining === -1
      ? this._prevScreen.length
      : firstRemaining;
    
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
    
    // Update prev screen state
    this.captureScreen();
  }

  /** Check if a line exists anywhere in the current visible screen (char-only comparison). */
  private lineExistsInScreen(line: ScreenCell[]): boolean {
    for (let i = 0; i < this._rows; i++) {
      if (cellsCharEqual(line, this.screen.getLine(i))) return true;
    }
    return false;
  }

  /** Check if a line is blank (all spaces/nulls/empty). */
  private isBlankLine(line: ScreenCell[]): boolean {
    return line.every(c => c.char === ' ' || c.char === '\0' || c.char === '');
  }

  /** Resize the terminal. */
  resize(cols: number, rows: number): void {
    log.debug(`[RESIZE] before: cols=${this._cols} rows=${this._rows} scrollback=${this._scrollbackBuffer.length} viewportOffset=${this._viewportOffset}`);

    // When shrinking width, snapshot old grid to capture rows that may be
    // discarded during reflow (wrapped lines produce more rows, top ones truncated)
    const isShrinking = cols < this._cols;
    let oldGridRows: ScreenCell[][] | null = null;
    let oldGridTexts: string[] | null = null;

    if (isShrinking) {
      oldGridRows = [];
      oldGridTexts = [];
      for (let i = 0; i < this._rows; i++) {
        const row = this.screen.getLine(i).map(c => ({ ...c }));
        oldGridRows.push(row);
        oldGridTexts.push(row.map(c => c.char || ' ').join('').trimEnd());
      }
    }

    this._cols = cols;
    this._rows = rows;
    this.screen.resize(cols, rows);

    // After shrinking: capture rows that were lost from the grid
    if (isShrinking && oldGridRows && oldGridTexts) {
      const newGridTexts = new Set<string>();
      for (let i = 0; i < this._rows; i++) {
        const text = this.screen.getLine(i).map(c => c.char || ' ').join('').trimEnd();
        if (text.length > 0) newGridTexts.add(text);
      }

      let capturedCount = 0;
      for (let i = 0; i < oldGridRows.length; i++) {
        if (oldGridTexts[i].length > 0 && !newGridTexts.has(oldGridTexts[i])) {
          this._scrollbackBuffer.push(oldGridRows[i]);
          capturedCount++;
        }
      }

      while (this._scrollbackBuffer.length > this._scrollbackLimit) {
        this._scrollbackBuffer.shift();
      }

      if (capturedCount > 0) {
        log.debug(`[RESIZE] captured ${capturedCount} lost rows into scrollback`);
      }
    }

    // Reset viewport to bottom
    this._viewportOffset = 0;
    const vtermOffset = this.screen.getViewportOffset();
    if (vtermOffset > 0) {
      this.screen.scrollViewport(-vtermOffset);
    }
    this.captureScreen();

    log.debug(`[RESIZE] after: cols=${cols} rows=${rows} scrollback=${this._scrollbackBuffer.length} viewportOffset=${this._viewportOffset}`);

    // Fix: eliminate blank rows between last content line and cursor
    const cursorY = this.screen.getCursorPosition().y;
    let blankRowsAboveCursor = 0;
    for (let row = cursorY - 1; row >= 0; row--) {
      const cells = this.screen.getLine(row);
      if (cells.every(c => c.char === ' ' || c.char === '\0' || c.char === '')) {
        blankRowsAboveCursor++;
      } else break;
    }
    if (blankRowsAboveCursor > 0) {
      const firstBlankRow = cursorY - blankRowsAboveCursor;
      const seq = `\x1b[${firstBlankRow + 1};1H${'\x1b[M'.repeat(blankRowsAboveCursor)}`;
      this.screen.process(new TextEncoder().encode(seq));
      this.captureScreen();
      log.debug(`[RESIZE] fix: deleted ${blankRowsAboveCursor} blank line(s) above cursor`);
    }
    this._generation++;
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
    return this._viewportOffset;
  }

  /** Scroll the viewport. Positive = up (older), negative = down (newer). */
  scrollViewport(delta: number): void {
    const before = this._viewportOffset;
    const maxOffset = this._scrollbackBuffer.length;
    const newOffset = Math.max(0, Math.min(maxOffset, before + delta));
    const actualDelta = newOffset - before;

    this._viewportOffset = newOffset;

    // Keep vterm.js in sync so its internal state stays consistent,
    // but we don't rely on its scrollback length for offset tracking.
    if (actualDelta !== 0) {
      this.screen.scrollViewport(actualDelta);
    }

    log.debug(`SCROLL_VIEWPORT: delta=${delta}, before=${before}, after=${this._viewportOffset}, scrollback=${maxOffset}`);
  }

  /** Scroll to bottom (viewport offset = 0). */
  scrollToBottom(): void {
    if (this._viewportOffset > 0) {
      this.screen.scrollViewport(-this._viewportOffset);
      log.debug(`SCROLL_TO_BOTTOM: was at offset=${this._viewportOffset}`);
      this._viewportOffset = 0;
    }
  }

  /** Check if viewport is at the bottom. */
  isAtBottom(): boolean {
    return this._viewportOffset === 0;
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
    const viewportOffset = this._viewportOffset;
    const scrollbackSize = this._scrollbackBuffer.length;
    log.trace(`GET_STYLED_LINES: rows=${this._rows}, scrollback=${scrollbackSize}, viewportOffset=${viewportOffset}`);

    for (let row = 0; row < this._rows; row++) {
      const scrollbackIndex = scrollbackSize - viewportOffset + row;

      let cells: ScreenCell[];
      let source: string;
      if (scrollbackIndex >= 0 && scrollbackIndex < scrollbackSize) {
        cells = this._scrollbackBuffer[scrollbackIndex];
        source = `SCROLLBACK[${scrollbackIndex}]`;
      } else {
        const gridRow = scrollbackIndex - scrollbackSize;
        cells = this.screen.getLine(gridRow);
        source = `GRID[${gridRow}]`;
      }

      // Detect blank: all cells are space
      const content = cells.map(c => c.char).join('');
      const trimmed = content.trimEnd();
      const isBlank = trimmed.length === 0;

      // Per-row render logs removed — too verbose for continuous render loop

      lines.push(this.cellsToStyledText(cells));
    }

    this._updateCount++;
    return lines;
  }

  /**
   * Get a single row as StyledText.
   * Note: row is viewport-relative (0 = top of visible area)
   */
  getStyledLine(row: number): StyledText {
    const viewportOffset = this._viewportOffset;
    const scrollbackSize = this._scrollbackBuffer.length;
    const scrollbackIndex = scrollbackSize - viewportOffset + row;
    
    let cells: ScreenCell[];
    if (scrollbackIndex >= 0 && scrollbackIndex < scrollbackSize) {
      cells = this._scrollbackBuffer[scrollbackIndex];
    } else {
      const gridRow = scrollbackIndex - scrollbackSize;
      cells = this.screen.getLine(gridRow);
    }
    
    // Per-line debug logs removed — too verbose for continuous render loop
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

      // Skip the right half (continuation cell) of a wide character.
      // In vterm.js, a wide char (CJK/emoji) occupies Cell[i] with wide=true
      // and Cell[i+1] with char='' as a spacer. Without this check, the spacer
      // becomes a visible space, inflating the text width and causing line merging.
      if (i > 0 && cells[i - 1].wide && cell.char === '') {
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
    // if (colorPairs.size > 0) {
    //   log.debug(`COLORS: ${[...colorPairs].join(' | ')}`);
    // }

    return new StyledText(chunks);
  }

  /**
   * Get plain text for a row (for debugging).
   * Note: row is viewport-relative
   */
  getLineText(row: number): string {
    const viewportOffset = this._viewportOffset;
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

  /** Get raw screen cells for a row (handles scrollback/viewport). */
  getLineCells(row: number): ScreenCell[] {
    const viewportOffset = this._viewportOffset;
    const scrollbackSize = this._scrollbackBuffer.length;
    const scrollbackIndex = scrollbackSize - viewportOffset + row;

    if (scrollbackIndex >= 0 && scrollbackIndex < scrollbackSize) {
      return this._scrollbackBuffer[scrollbackIndex];
    }
    return this.screen.getLine(scrollbackIndex - scrollbackSize);
  }

  /** Get display width of a string (CJK/emoji=2, others=1). */
  getDisplayWidth(text: string): number {
    let width = 0;
    for (const char of text) {
      const code = char.codePointAt(0)!;
      if (
        (code >= 0x1100 && code <= 0x115F) ||
        (code >= 0x2E80 && code <= 0xA4CF && code !== 0x303F) ||
        (code >= 0xAC00 && code <= 0xD7A3) ||
        (code >= 0xF900 && code <= 0xFAFF) ||
        (code >= 0xFE10 && code <= 0xFE6F) ||
        (code >= 0xFF01 && code <= 0xFF60) ||
        (code >= 0xFFE0 && code <= 0xFFE6) ||
        (code >= 0x1F000 && code <= 0x1FAFF) ||
        (code >= 0x20000 && code <= 0x2FA1F)
      ) {
        width += 2;
      } else {
        width += 1;
      }
    }
    return width;
  }

  /** Reset the terminal. */
  reset(): void {
    this.screen.reset();
    this._scrollbackBuffer = [];
  }
}
