import { Cell, CursorPosition } from '../types/terminal';
import { createCell } from './cell';

export interface SGRState {
  fg: number | null;
  bg: number | null;
  bold: boolean;
  dim: boolean;
  italic: boolean;
  underline: boolean;
  blink: boolean;
  reverse: boolean;
}

export class ScreenBuffer {
  rows: number;
  cols: number;
  grid: Cell[][];
  cursor: CursorPosition;
  scrollback: Cell[][];
  private maxScrollbackLines: number;
  private currentAttrs: SGRState;
  private dirty: boolean;
  private dirtyRows: Set<number>;
  private _scrollOffset: number = 0; // lines scrolled up from bottom (0 = bottom)

  constructor(
    rows: number = 24,
    cols: number = 80,
    maxScrollbackLines: number = 1000,
  ) {
    this.rows = rows;
    this.cols = cols;
    this.maxScrollbackLines = maxScrollbackLines;
    this.grid = [];
    this.scrollback = [];
    this.dirty = false;
    this.dirtyRows = new Set();
    this.cursor = { row: 0, col: 0, visible: true };
    this.currentAttrs = {
      fg: null,
      bg: null,
      bold: false,
      dim: false,
      italic: false,
      underline: false,
      blink: false,
      reverse: false,
    };

    // Initialize grid with empty cells
    for (let r = 0; r < rows; r++) {
      this.grid.push(this.createEmptyRow());
    }
  }

  // ---------------------------------------------------------------------------
  // Internal helpers
  // ---------------------------------------------------------------------------

  private createEmptyRow(): Cell[] {
    const row: Cell[] = [];
    for (let c = 0; c < this.cols; c++) {
      row.push(createCell());
    }
    return row;
  }

  private applyCurrentAttrs(cell: Cell): void {
    cell.fg = this.currentAttrs.fg;
    cell.bg = this.currentAttrs.bg;
    cell.bold = this.currentAttrs.bold;
    cell.dim = this.currentAttrs.dim;
    cell.italic = this.currentAttrs.italic;
    cell.underline = this.currentAttrs.underline;
    cell.blink = this.currentAttrs.blink;
    cell.reverse = this.currentAttrs.reverse;
  }

  // ---------------------------------------------------------------------------
  // Resize
  // ---------------------------------------------------------------------------

  resize(rows: number, cols: number): void {
    const newGrid: Cell[][] = [];

    for (let r = 0; r < rows; r++) {
      const newRow: Cell[] = [];
      for (let c = 0; c < cols; c++) {
        if (r < this.rows && c < this.cols) {
          // Copy existing cell
          const old = this.grid[r][c];
          newRow.push({ ...old });
        } else {
          newRow.push(createCell());
        }
      }
      newGrid.push(newRow);
    }

    this.grid = newGrid;
    this.rows = rows;
    this.cols = cols;

    // Clamp cursor
    this.cursor.row = Math.min(this.cursor.row, this.rows - 1);
    this.cursor.col = Math.min(this.cursor.col, this.cols - 1);

    this.markAllDirty();
  }

  // ---------------------------------------------------------------------------
  // Writing
  // ---------------------------------------------------------------------------

  write(text: string): void {
    for (const ch of text) {
      if (ch === '\n') {
        this.newLine();
      } else if (ch === '\r') {
        this.carriageReturn();
      } else {
        // Wrap if cursor is past the last column
        if (this.cursor.col >= this.cols) {
          this.cursor.col = 0;
          this.cursor.row++;
          if (this.cursor.row >= this.rows) {
            this.scrollUp(1);
            this.cursor.row = this.rows - 1;
          }
        }

        if (this.cursor.row < this.rows && this.cursor.col < this.cols) {
          const cell = this.grid[this.cursor.row][this.cursor.col];
          cell.char = ch;
          this.applyCurrentAttrs(cell);
          this.markDirty(this.cursor.row);
        }

        this.cursor.col++;

        // If we just wrote past the last column, wrap on next write
        // (do not wrap here — wrapping is a side-effect of the next char)
      }
    }
  }

  writeLine(text: string): void {
    this.write(text);
  }

  // ---------------------------------------------------------------------------
  // Cursor Management
  // ---------------------------------------------------------------------------

  setCursor(row: number, col: number): void {
    this.cursor.row = Math.max(0, Math.min(row, this.rows - 1));
    this.cursor.col = Math.max(0, Math.min(col, this.cols - 1));
  }

  moveCursor(dRow: number, dCol: number): void {
    this.setCursor(this.cursor.row + dRow, this.cursor.col + dCol);
  }

  newLine(): void {
    this.cursor.row++;
    this.cursor.col = 0;
    if (this.cursor.row >= this.rows) {
      this.scrollUp(1);
      this.cursor.row = this.rows - 1;
    }
  }

  carriageReturn(): void {
    this.cursor.col = 0;
  }

  backspace(): void {
    if (this.cursor.col > 0) {
      this.cursor.col--;
    } else if (this.cursor.row > 0) {
      this.cursor.row--;
      this.cursor.col = this.cols - 1;
    }
    // Reset cell at new cursor position
    const cell = this.grid[this.cursor.row][this.cursor.col];
    Object.assign(cell, createCell());
    this.markDirty(this.cursor.row);
  }

  // ---------------------------------------------------------------------------
  // Clear Operations
  // ---------------------------------------------------------------------------

  clearScreen(): void {
    for (let r = 0; r < this.rows; r++) {
      for (let c = 0; c < this.cols; c++) {
        Object.assign(this.grid[r][c], createCell());
      }
    }
    this.markAllDirty();
  }

  clearLine(): void {
    for (let c = 0; c < this.cols; c++) {
      Object.assign(this.grid[this.cursor.row][c], createCell());
    }
    this.markDirty(this.cursor.row);
  }

  clearToEndOfLine(): void {
    const row = this.cursor.row;
    for (let c = this.cursor.col; c < this.cols; c++) {
      Object.assign(this.grid[row][c], createCell());
    }
    this.markDirty(row);
  }

  clearToEndOfScreen(): void {
    const startRow = this.cursor.row;
    const startCol = this.cursor.col;
    for (let r = startRow; r < this.rows; r++) {
      const beginCol = r === startRow ? startCol : 0;
      for (let c = beginCol; c < this.cols; c++) {
        Object.assign(this.grid[r][c], createCell());
      }
      this.markDirty(r);
    }
  }

  clearFromStartToCursor(): void {
    for (let r = 0; r <= this.cursor.row; r++) {
      const endCol = r === this.cursor.row ? this.cursor.col : this.cols;
      for (let c = 0; c < endCol; c++) {
        Object.assign(this.grid[r][c], createCell());
      }
      this.markDirty(r);
    }
  }

  // ---------------------------------------------------------------------------
  // Scroll
  // ---------------------------------------------------------------------------

  scrollUp(lines: number = 1): void {
    const actualLines = Math.min(lines, this.rows);
    if (actualLines <= 0) return;

    // Push scrolled-off rows to scrollback
    for (let i = 0; i < actualLines; i++) {
      this.scrollback.push(this.grid[i]);
    }

    // Remove top rows from grid
    this.grid.splice(0, actualLines);

    // Add new empty rows at bottom
    for (let i = 0; i < actualLines; i++) {
      this.grid.push(this.createEmptyRow());
    }

    // Trim scrollback to maxScrollbackLines (remove oldest first)
    while (this.scrollback.length > this.maxScrollbackLines) {
      this.scrollback.shift();
    }

    this.markAllDirty();
  }

  scrollDown(lines: number = 1): void {
    const actualLines = Math.min(lines, this.rows);
    if (actualLines <= 0) return;

    // Remove bottom rows
    this.grid.splice(this.rows - actualLines, actualLines);

    // Add new empty rows at top
    for (let i = 0; i < actualLines; i++) {
      this.grid.unshift(this.createEmptyRow());
    }

    this.markAllDirty();
  }

  // ---------------------------------------------------------------------------
  // SGR (Select Graphic Rendition)
  // ---------------------------------------------------------------------------

  setSGR(params: number[]): void {
    let i = 0;
    while (i < params.length) {
      const p = params[i];

      switch (p) {
        case 0:
          // Reset all attributes
          this.currentAttrs.fg = null;
          this.currentAttrs.bg = null;
          this.currentAttrs.bold = false;
          this.currentAttrs.dim = false;
          this.currentAttrs.italic = false;
          this.currentAttrs.underline = false;
          this.currentAttrs.blink = false;
          this.currentAttrs.reverse = false;
          break;
        case 1:
          this.currentAttrs.bold = true;
          break;
        case 2:
          this.currentAttrs.dim = true;
          break;
        case 3:
          this.currentAttrs.italic = true;
          break;
        case 4:
          this.currentAttrs.underline = true;
          break;
        case 5:
          this.currentAttrs.blink = true;
          break;
        case 7:
          this.currentAttrs.reverse = true;
          break;
        case 22:
          this.currentAttrs.bold = false;
          break;
        case 23:
          this.currentAttrs.italic = false;
          break;
        case 24:
          this.currentAttrs.underline = false;
          break;
        case 25:
          this.currentAttrs.blink = false;
          break;
        case 27:
          this.currentAttrs.reverse = false;
          break;

        // Foreground colors (normalize 30-37 → 0-7)
        case 30: case 31: case 32: case 33:
        case 34: case 35: case 36: case 37:
          this.currentAttrs.fg = p - 30;
          break;
        case 38: {
          // Extended foreground color
          i++;
          if (i < params.length && params[i] === 5) {
            // 256-color
            i++;
            if (i < params.length) {
              this.currentAttrs.fg = params[i];
            }
          }
          // (2;r;g;b true-color is not implemented per spec)
          break;
        }
        case 39:
          this.currentAttrs.fg = null;
          break;

        // Background colors (normalize 40-47 → 0-7)
        case 40: case 41: case 42: case 43:
        case 44: case 45: case 46: case 47:
          this.currentAttrs.bg = p - 40;
          break;
        case 48: {
          // Extended background color
          i++;
          if (i < params.length && params[i] === 5) {
            // 256-color
            i++;
            if (i < params.length) {
              this.currentAttrs.bg = params[i];
            }
          }
          break;
        }
        case 49:
          this.currentAttrs.bg = null;
          break;

        // Bright foreground (90-97 → 8-15)
        case 90: case 91: case 92: case 93:
        case 94: case 95: case 96: case 97:
          this.currentAttrs.fg = p - 82;
          break;

        // Bright background (100-107 → 8-15)
        case 100: case 101: case 102: case 103:
        case 104: case 105: case 106: case 107:
          this.currentAttrs.bg = p - 92;
          break;
      }

      i++;
    }
  }

  getCurrentAttributes(): SGRState {
    return { ...this.currentAttrs };
  }

  // ---------------------------------------------------------------------------
  // Dirty Tracking
  // ---------------------------------------------------------------------------

  markDirty(row: number): void {
    this.dirty = true;
    this.dirtyRows.add(row);
  }

  markAllDirty(): void {
    this.dirty = true;
    for (let r = 0; r < this.rows; r++) {
      this.dirtyRows.add(r);
    }
  }

  isDirty(): boolean {
    return this.dirty;
  }

  clearDirty(): void {
    this.dirty = false;
    this.dirtyRows.clear();
  }

  getDirtyRows(): number[] {
    return Array.from(this.dirtyRows);
  }

  // ---------------------------------------------------------------------------
  // Accessors
  // ---------------------------------------------------------------------------

  getCell(row: number, col: number): Cell {
    if (row < 0 || row >= this.rows || col < 0 || col >= this.cols) {
      return createCell();
    }
    return this.grid[row][col];
  }

  getVisibleLines(): Cell[][] {
    // When scrolled up, show scrollback lines + visible grid (clipped by viewport)
    if (this._scrollOffset > 0) {
      const totalAvailable = this.scrollback.length + this.rows;
      const offset = Math.min(this._scrollOffset, this.scrollback.length);
      const lines: Cell[][] = [];

      // Lines from scrollback (oldest first)
      const scrollbackStart = Math.max(0, this.scrollback.length - offset);
      for (let i = scrollbackStart; i < this.scrollback.length; i++) {
        lines.push(this.scrollback[i]);
      }

      // Fill remaining with visible grid rows
      const remaining = this.rows - lines.length;
      for (let r = 0; r < remaining; r++) {
        lines.push(this.grid[r]);
      }

      return lines;
    }
    return this.grid.map(row => row.map(cell => ({ ...cell })));
  }

  getScrollbackLines(): Cell[][] {
    return this.scrollback.map(row => row.map(cell => ({ ...cell })));
  }

  getMaxScrollbackLines(): number {
    return this.maxScrollbackLines;
  }

  // ---------------------------------------------------------------------------
  // Scroll offset (for user scroll-wheel viewing)
  // ---------------------------------------------------------------------------

  /** How many lines the user has scrolled up from the bottom. 0 = at bottom. */
  getScrollOffset(): number {
    return this._scrollOffset;
  }

  /** Set scroll offset. Clamped to [0, scrollback.length]. */
  setScrollOffset(offset: number): void {
    this._scrollOffset = Math.max(0, Math.min(offset, this.scrollback.length));
  }

  /** Scroll up by `lines` (toward older content). Returns new offset. */
  scrollBy(lines: number): number {
    this._scrollOffset = Math.max(0, Math.min(this._scrollOffset + lines, this.scrollback.length));
    return this._scrollOffset;
  }

  /** Jump to the very bottom (newest content). */
  scrollToBottom(): void {
    this._scrollOffset = 0;
  }

  /** Are we at the bottom (auto-scroll position)? */
  isAtBottom(): boolean {
    return this._scrollOffset === 0;
  }
}
