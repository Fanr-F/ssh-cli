import { Box, Text, StyledText } from '@opentui/core';
import { VtermAdapter } from './vterm-adapter';

export class TerminalRenderer {
  private vterm: VtermAdapter | null = null;
  private contentBox: ReturnType<typeof Box> | null = null;
  private lineTexts: any[] = [];
  private initialized = false;
  private _updateCount = 0;

  constructor() {}

  setVterm(vterm: VtermAdapter): void {
    this.vterm = vterm;
  }

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

  resolveChildren(children: any[]): void {
    this.lineTexts = children;
    this.initialized = true;
  }

  updateContent(): boolean {
    if (!this.vterm || !this.initialized || this.lineTexts.length === 0) {
      return false;
    }

    this._updateCount++;
    const styledLines = this.vterm.getStyledLines();

    for (let i = 0; i < this.lineTexts.length; i++) {
      const textRenderable = this.lineTexts[i];
      if (i < styledLines.length) {
        // Must use textBuffer.setStyledText() directly —
        // .content setter calls setText() which serializes StyledText to "[object Object]"
        textRenderable.textBuffer.setStyledText(styledLines[i]);
      } else {
        textRenderable.textBuffer.setStyledText(new StyledText([]));
      }
    }

    return true;
  }

  getVisibleLines(): string[] {
    if (!this.vterm) return [];
    const lines: string[] = [];
    for (let i = 0; i < this.vterm.rows; i++) {
      lines.push(this.vterm.getLineText(i));
    }
    return lines;
  }
}
