import { Box, Text, StyledText } from '@opentui/core';
import { VtermAdapter } from './vterm-adapter';
import { createLogger } from '../logger';

const log = createLogger('renderer');

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

  createContentBox(rows: number, id: string = 'terminal-content'): ReturnType<typeof Box> {
    this.initialized = false;
    this.lineTexts = [];

    const textChildren = Array.from({ length: rows }, () =>
      Text({ content: '', fg: '#CCCCCC' }),
    );

    this.contentBox = Box(
      {
        id,
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
      log.debug(`[TERMINAL RENDERER] updateContent: skipped (vterm=${!!this.vterm}, initialized=${this.initialized}, lineTexts=${this.lineTexts.length})`);
      return false;
    }

    this._updateCount++;
    try {
      const styledLines = this.vterm.getStyledLines();
      const cursorPos = this.vterm.getCursorPosition();
      const cursorVisible = this.vterm.isCursorVisible();
      const viewportOffset = this.vterm.getViewportOffset();

      // Log first few updates and periodically
      if (this._updateCount <= 5 || this._updateCount % 50 === 0) {
        log.debug(`[TERMINAL RENDERER] updateContent: count=${this._updateCount}, lines=${styledLines.length}, viewportOffset=${viewportOffset}, cursorPos=${JSON.stringify(cursorPos)}`);
        // Log first 3 lines content
        for (let i = 0; i < Math.min(3, styledLines.length); i++) {
          const text = this.getTextFromStyledText(styledLines[i]);
          log.debug(`[TERMINAL RENDERER] line ${i}: "${text.substring(0, 50)}"`);
        }
      }

      // Calculate total scrollback + screen lines
      const totalLines = this.vterm.getScrollbackLength() + this.vterm.rows;
      
      for (let i = 0; i < this.lineTexts.length; i++) {
        const textRenderable = this.lineTexts[i];
        if (i < styledLines.length) {
          let styledText = styledLines[i];

          // Draw cursor on the line that has it, but only if cursor is in visible viewport
          // cursorPos.y is absolute buffer position from vterm.js (0 = top of screen)
          // When viewportOffset > 0, the cursor is at absolute position cursorPos.y
          // We need to check if it's visible in our viewport
          
          // The visible range in absolute terms:
          // - Top of visible = scrollbackSize - viewportOffset (oldest visible line index in our buffer)
          // - Bottom of visible = scrollbackSize - viewportOffset + rows - 1
          
          // But cursorPos.y is from vterm.js grid (0 = top of visible screen)
          // So cursor is at absolute position: scrollbackSize + cursorPos.y
          
          // For now, only show cursor when at bottom (viewportOffset = 0)
          // TODO: properly calculate cursor position when scrolled up
          const cursorInViewport = cursorVisible && 
            viewportOffset === 0 &&
            cursorPos.y >= 0 && 
            cursorPos.y < this.vterm.rows &&
            cursorPos.x < this.vterm.cols;
          
          if (cursorInViewport && i === cursorPos.y) {
            styledText = this.injectCursor(styledText, cursorPos.x);
          }

          textRenderable.textBuffer.setStyledText(styledText);
        } else {
          textRenderable.textBuffer.setStyledText(new StyledText([]));
        }
      }

      return true;
    } catch (err) {
      log.error({ error: err }, 'updateContent failed');
      return false;
    }
  }

  /**
   * Extract plain text from StyledText for logging.
   */
  private getTextFromStyledText(styledText: StyledText): string {
    const rawChunks = (styledText as any).chunks ?? [];
    return rawChunks.map((c: any) => c.text ?? '').join('');
  }

  /**
   * Inject a block cursor at the given column position in a StyledText.
   * Replaces the character at cursorX with an inverse-styled version.
   */
  private injectCursor(styledText: StyledText, cursorX: number): StyledText {
    const chunks: Array<{
      __isChunk: true;
      text: string;
      fg?: string;
      bg?: string;
      attributes: number;
    }> = [];

    let col = 0;
    const rawChunks = (styledText as any).chunks ?? [];

    for (const chunk of rawChunks) {
      const text = chunk.text ?? '';
      for (let j = 0; j < text.length; j++) {
        const char = text[j];
        if (col === cursorX) {
          // Cursor: inverse the colors (swap fg/bg)
          chunks.push({
            __isChunk: true,
            text: char === ' ' ? ' ' : char,
            fg: chunk.bg ?? '#0d1117',
            bg: chunk.fg ?? '#CCCCCC',
            attributes: 0,
          });
        } else {
          chunks.push({
            __isChunk: true,
            text: char,
            fg: chunk.fg,
            bg: chunk.bg,
            attributes: chunk.attributes ?? 0,
          });
        }
        col++;
      }
    }

    // If cursor is past all content, append a block cursor
    if (cursorX >= col) {
      chunks.push({
        __isChunk: true,
        text: ' ',
        fg: '#0d1117',
        bg: '#CCCCCC',
        attributes: 0,
      });
    }

    return new StyledText(chunks);
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
