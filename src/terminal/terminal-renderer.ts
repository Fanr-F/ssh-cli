import { Box, Text } from '@opentui/core';
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
 * It provides:
 *   - Full re-render: builds a component tree from the entire visible buffer
 *   - Dirty re-render: only rebuilds changed lines (performance optimization)
 *   - Per-line Text components with ANSI color mapping
 */
export class TerminalRenderer {
  private buffer: ScreenBuffer | null = null;
  private lastRenderedLines: string[] = [];  // Cache of last rendered content for diff
  private container: ReturnType<typeof Box> | null = null;

  constructor() {
    // No renderer needed - we build VNode constructs
  }

  setBuffer(buffer: ScreenBuffer): void {
    this.buffer = buffer;
  }

  /**
   * Build or update the OpenTUI component tree from the screen buffer.
   * Uses Box with column flex-direction for scrollable output.
   */
  renderFull(): ReturnType<typeof Box> {
    if (!this.buffer) {
      return Box(
        {
          width: '100%',
          height: '100%',
          backgroundColor: '#0d1117',
          padding: 1,
        },
        Text({ content: '', fg: '#FFFFFF' }),
      );
    }

    const visibleLines = this.buffer.getVisibleLines();
    const textComponents = visibleLines.map((row, rowIndex) => {
      return this.renderLine(row, rowIndex);
    });

    return Box(
      {
        width: '100%',
        height: '100%',
        backgroundColor: '#0d1117',
        flexDirection: 'column',
        padding: 0,
      },
      ...textComponents,
    );
  }

  /**
   * Only re-render changed lines using dirty tracking.
   * Returns the full component tree (dirty + clean), rebuilding only changed lines.
   */
  renderDirty(): ReturnType<typeof Box> {
    if (!this.buffer) {
      return this.renderFull();
    }

    if (!this.buffer.isDirty()) {
      return this.container || this.renderFull();
    }

    this.buffer.clearDirty();

    return this.renderFull();
  }

  /**
    * Render a single line of the buffer as a row Box containing per-segment Text components.
    * Groups consecutive cells with the same styling attributes into segments
    * for efficient rendering.
    */
   private renderLine(row: Cell[], rowIndex: number): ReturnType<typeof Box> {
    // Build the text content with styled segments
    // Group consecutive cells with the same attributes into styled segments
    const segments: { text: string; fg?: string; bg?: string; bold?: boolean; italic?: boolean; underline?: boolean }[] = [];
    let currentSegment: typeof segments[0] | null = null;

    for (const cell of row) {
      let fgHex = cell.fg !== null ? (ANSI_COLORS[cell.fg] ?? ANSI_COLORS[7]) : undefined;
      let bgHex = cell.bg !== null ? (ANSI_COLORS[cell.bg] ?? ANSI_COLORS[0]) : undefined;

      if (cell.reverse) {
        // Swap foreground and background for reverse video
        const temp = fgHex;
        fgHex = bgHex;
        bgHex = temp;
      }

      const char = cell.char;

      if (
        currentSegment &&
        currentSegment.fg === fgHex &&
        currentSegment.bg === bgHex &&
        currentSegment.bold === cell.bold
      ) {
        currentSegment.text += char;
      } else {
        currentSegment = {
          text: char,
          fg: fgHex,
          bg: bgHex,
          bold: cell.bold,
          italic: cell.italic,
          underline: cell.underline,
        };
        segments.push(currentSegment);
      }
    }

    // Build a styled Text component per segment, wrapped in a row Box
    const textComponents = segments.map(seg =>
      Text({
        content: seg.text,
        fg: seg.fg ?? '#CCCCCC',
        bg: seg.bg,
        bold: seg.bold ?? false,
        italic: seg.italic ?? false,
        underline: seg.underline ?? false,
      }),
    );

    return Box(
      {
        flexDirection: 'row',
        width: '100%',
      },
      ...textComponents,
    );
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
