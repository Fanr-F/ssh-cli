import { Box, Text, StyledText, parseColor } from '@opentui/core';
import { ScreenBuffer } from './screen-buffer';
import { Cell } from '../types/terminal';

// ANSI 16-color palette mapped to hex colors (standard terminal colors)
const ANSI_COLORS: Record<number, string> = {
  0: '#000000',  // Black
  1: '#CC0000',  // Red
  2: '#00CC00',  // Green
  3: '#CCCC00',  // Yellow
  4: '#0000CC',  // Blue
  5: '#CC00CC',  // Magenta
  6: '#00CCCC',  // Cyan
  7: '#CCCCCC',  // White
  8: '#555555',  // Bright Black (Gray)
  9: '#FF5555',  // Bright Red
  10: '#55FF55', // Bright Green
  11: '#FFFF55', // Bright Yellow
  12: '#5555FF', // Bright Blue
  13: '#FF55FF', // Bright Magenta
  14: '#55FFFF', // Bright Cyan
  15: '#FFFFFF', // Bright White
};

/**
 * TerminalRenderer converts ScreenBuffer cells into OpenTUI Box/Text components.
 *
 * Uses a persistent Box with per-line Text components. Content is updated
 * in-place by setting `.content` on resolved Text renderables, avoiding
 * native resource churn (SyntaxStyle / TextBuffer allocation in WASM).
 */
export class TerminalRenderer {
  private buffer: ScreenBuffer | null = null;
  private contentBox: ReturnType<typeof Box> | null = null;
  private lineTexts: any[] = [];  // Resolved Text renderable references
  private initialized = false;

  constructor() {}

  setBuffer(buffer: ScreenBuffer): void {
    this.buffer = buffer;
  }

  /**
   * Create the persistent terminal content box with one Text child per row.
   * Call this ONCE when SSH connects. The returned VNode should be added
   * to the connectedBox via setTerminalContent().
   */
  createContentBox(rows: number): ReturnType<typeof Box> {
    this.initialized = false;
    this.lineTexts = [];

    const textChildren = Array.from({ length: rows }, () =>
      Text({ content: '', fg: '#CCCCCC' }),
    );

    this.contentBox = Box(
      {
        id: 'terminal-content',
        width: '100%',
        height: '100%',
        backgroundColor: '#0d1117',
        flexDirection: 'column',
        padding: 0,
      },
      ...textChildren,
    );

    return this.contentBox;
  }

  /**
   * Resolve real Text renderables after the box is mounted.
   * Call this once after setTerminalContent() adds the box to the tree.
   */
  resolveChildren(children: any[]): void {
    this.lineTexts = children;
    this.initialized = true;
  }

  /**
   * Update terminal content in-place by setting .content on resolved Text
   * renderables. Returns true if content was updated, false if not ready.
   */
  updateContent(): boolean {
    if (!this.buffer || !this.initialized || this.lineTexts.length === 0) return false;

    this.buffer.clearDirty();
    const visibleLines = this.buffer.getVisibleLines();
    const cursor = this.buffer.cursor;

    for (let i = 0; i < this.lineTexts.length; i++) {
      if (i < visibleLines.length) {
        const styledText = this.buildLineStyledText(visibleLines[i], i, cursor);
        this.lineTexts[i].content = styledText;
      } else {
        // Clear extra lines
        this.lineTexts[i].content = new StyledText([]);
      }
    }

    return true;
  }

  /**
   * Build a StyledText for a single line from buffer cells.
   * Groups consecutive cells with the same styling into styled chunks.
   */
  private buildLineStyledText(row: Cell[], rowIndex: number, cursor?: { row: number; col: number; visible: boolean }): StyledText {
    const segments = this.buildSegments(row, rowIndex, cursor);

    const chunks = segments.map(seg => ({
      __isChunk: true as const,
      text: seg.text,
      fg: seg.fg ? parseColor(seg.fg) : undefined,
      bg: seg.bg ? parseColor(seg.bg) : undefined,
      attributes: 0,
    }));

    return new StyledText(chunks);
  }

  /**
   * Group consecutive cells with the same styling into segments.
   */
  private buildSegments(row: Cell[], rowIndex: number, cursor?: { row: number; col: number; visible: boolean }): { text: string; fg?: string; bg?: string }[] {
    const segments: { text: string; fg?: string; bg?: string }[] = [];
    let current: typeof segments[0] | null = null;

    const isCursorRow = cursor?.visible && cursor.row === rowIndex;

    for (let colIndex = 0; colIndex < row.length; colIndex++) {
      const cell = row[colIndex];
      let fgHex = cell.fg !== null ? (ANSI_COLORS[cell.fg] ?? ANSI_COLORS[7]) : undefined;
      let bgHex = cell.bg !== null ? (ANSI_COLORS[cell.bg] ?? ANSI_COLORS[0]) : undefined;

      if (cell.reverse) {
        const temp = fgHex;
        fgHex = bgHex;
        bgHex = temp;
      }

      // Cursor block: swap fg/bg
      if (isCursorRow && cursor && colIndex === cursor.col) {
        const cursorFg = bgHex ?? '#000000';
        const cursorBg = fgHex ?? '#CCCCCC';
        const char = cell.char === ' ' ? ' ' : cell.char;

        if (current && current.fg === cursorFg && current.bg === cursorBg) {
          current.text += char;
        } else {
          current = { text: char, fg: cursorFg, bg: cursorBg };
          segments.push(current);
        }
        continue;
      }

      const char = cell.char;

      if (current && current.fg === fgHex && current.bg === bgHex) {
        current.text += char;
      } else {
        current = { text: char, fg: fgHex, bg: bgHex };
        segments.push(current);
      }
    }

    return segments;
  }

  /**
   * Get the text representation of the visible buffer (for testing).
   */
  getVisibleLines(): string[] {
    if (!this.buffer) return [];
    const lines = this.buffer.getVisibleLines();
    return lines.map(row => row.map(c => c.char).join(''));
  }
}
