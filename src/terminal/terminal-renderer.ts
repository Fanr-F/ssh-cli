import { Generic, parseColor, type OptimizedBuffer } from '@opentui/core';
import { VtermAdapter } from './vterm-adapter';
import { createLogger } from '../logger';
import type { ScreenCell } from 'vterm.js';

const log = createLogger('renderer');

const DEFAULT_FG = parseColor('#CCCCCC');
const DEFAULT_BG = parseColor('#0d1117');

export class TerminalRenderer {
  private vterm: VtermAdapter | null = null;
  private contentBox: any = null;
  private _updateCount = 0;
  private _lastGeneration = -1;
  private _lastStyledLines: any[] = [];
  private _lastCursorPos: { x: number; y: number } = { x: 0, y: 0 };
  private _lastCursorVisible = false;
  private _lastViewportOffset = 0;
  private _selectionAnchor: { row: number; col: number } | null = null;
  private _selectionFocus: { row: number; col: number } | null = null;
  private _selectionSetup = false;

  constructor() {}

  setVterm(vterm: VtermAdapter): void {
    this.vterm = vterm;
  }

  clearSelection(): void {
    this._selectionAnchor = null;
    this._selectionFocus = null;
  }

  hasSelection(): boolean {
    return this._selectionAnchor !== null && this._selectionFocus !== null;
  }

  getSelectedText(): string {
    if (!this._selectionAnchor || !this._selectionFocus || !this.vterm) return '';

    const startRow = Math.min(this._selectionAnchor.row, this._selectionFocus.row);
    const endRow = Math.max(this._selectionAnchor.row, this._selectionFocus.row);
    const startCol = this._selectionAnchor.row < this._selectionFocus.row
      ? this._selectionAnchor.col
      : this._selectionAnchor.row > this._selectionFocus.row
        ? this._selectionFocus.col
        : Math.min(this._selectionAnchor.col, this._selectionFocus.col);
    const endCol = this._selectionAnchor.row < this._selectionFocus.row
      ? this._selectionFocus.col
      : this._selectionAnchor.row > this._selectionFocus.row
        ? this._selectionAnchor.col
        : Math.max(this._selectionAnchor.col, this._selectionFocus.col);

    const lines: string[] = [];
    for (let row = startRow; row <= endRow; row++) {
      const lineText = this.vterm.getLineText(row);
      const cells = this.vterm.getLineCells(row);
      const startIdx = this.cellToCharIndex(cells, row === startRow ? startCol : 0);
      const endIdx = this.cellToCharIndex(cells, row === endRow ? endCol : cells.length - 1);
      lines.push(lineText.substring(startIdx, endIdx + 1));
    }
    return lines.join('\n');
  }

  private cellToCharIndex(cells: ScreenCell[], cellPos: number): number {
    let count = 0;
    for (let i = 0; i < cellPos && i < cells.length; i++) {
      if (!(cells[i].wide && cells[i].char === '')) count++;
    }
    return count;
  }

  private setupSelection(renderable: any): void {
    renderable.selectable = true;

    renderable.shouldStartSelection = (x: number, y: number): boolean => {
      const sx = Number(renderable._screenX) || 0;
      const sy = Number(renderable._screenY) || 0;
      const w = Number(renderable.width) || 0;
      const h = Number(renderable.height) || 0;
      const localX = x - sx;
      const localY = y - sy;
      return localX >= 0 && localX < w && localY >= 0 && localY < h;
    };

    renderable.onSelectionChanged = (selection: any): boolean => {
      if (!selection?.isActive) {
        this._selectionAnchor = null;
        this._selectionFocus = null;
        return false;
      }

      const sx = Number(renderable._screenX) || 0;
      const sy = Number(renderable._screenY) || 0;

      // Convert global screen coords to terminal row/col
      const anchorRow = Math.max(0, Math.min((selection.anchor.y - sy), (this.vterm?.rows ?? 1) - 1));
      const anchorCol = Math.max(0, Math.min((selection.anchor.x - sx), (this.vterm?.cols ?? 1) - 1));
      const focusRow = Math.max(0, Math.min((selection.focus.y - sy), (this.vterm?.rows ?? 1) - 1));
      const focusCol = Math.max(0, Math.min((selection.focus.x - sx), (this.vterm?.cols ?? 1) - 1));

      this._selectionAnchor = { row: anchorRow, col: anchorCol };
      this._selectionFocus = { row: focusRow, col: focusCol };
      return this.hasSelection();
    };

    renderable.hasSelection = (): boolean => {
      return this._selectionAnchor !== null && this._selectionFocus !== null;
    };

    renderable.getSelectedText = (): string => {
      if (!this._selectionAnchor || !this._selectionFocus || !this.vterm) return '';

      const startRow = Math.min(this._selectionAnchor.row, this._selectionFocus.row);
      const endRow = Math.max(this._selectionAnchor.row, this._selectionFocus.row);
      const startCol = this._selectionAnchor.row < this._selectionFocus.row
        ? this._selectionAnchor.col
        : this._selectionAnchor.row > this._selectionFocus.row
          ? this._selectionFocus.col
          : Math.min(this._selectionAnchor.col, this._selectionFocus.col);
      const endCol = this._selectionAnchor.row < this._selectionFocus.row
        ? this._selectionFocus.col
        : this._selectionAnchor.row > this._selectionFocus.row
          ? this._selectionAnchor.col
          : Math.max(this._selectionAnchor.col, this._selectionFocus.col);

      const lines: string[] = [];
      for (let row = startRow; row <= endRow; row++) {
        const lineText = this.vterm.getLineText(row);
        const cells = this.vterm.getLineCells(row);
        const startIdx = this.cellToCharIndex(cells, row === startRow ? startCol : 0);
        const endIdx = this.cellToCharIndex(cells, row === endRow ? endCol : cells.length - 1);
        lines.push(lineText.substring(startIdx, endIdx + 1));
      }
      return lines.join('\n');
    };
  }

  createContentBox(_rows: number, id: string = 'terminal-content'): any {
    this._updateCount = 0;

    this.contentBox = Generic({
      id,
      width: '100%',
      height: '100%',
      render: (buffer: OptimizedBuffer, _deltaTime: number, renderable: any) => {
        const w = Number(renderable.width) || 0;
        const h = Number(renderable.height) || 0;
        if (w === 0 || h === 0) return;
        const sx = Number(renderable._screenX) || 0;
        const sy = Number(renderable._screenY) || 0;

        // Monkey-patch selection methods on first frame
        if (!this._selectionSetup) {
          this._selectionSetup = true;
          this.setupSelection(renderable);
        }

        buffer.fillRect(sx, sy, w, h, DEFAULT_BG);
        this.renderTerminal(buffer, w, h, sx, sy);
      },
    });

    return this.contentBox;
  }

  resolveChildren(_children: any[]): void {
    // No-op: Generic renders directly to buffer
  }

  rebuildContentBox(rows: number, id: string = 'terminal-content'): any {
    return this.createContentBox(rows, id);
  }

  updateContent(): boolean {
    if (!this.vterm) return false;
    this._updateCount++;
    this._lastGeneration = -1; // invalidate cache on new SSH data
    return true;
  }

  private renderTerminal(buffer: OptimizedBuffer, width: number, height: number, sx: number, sy: number): void {
    if (!this.vterm) return;

    const gen = this.vterm.generation;
    const cursorPos = this.vterm.getCursorPosition();
    const cursorVisible = this.vterm.isCursorVisible();
    const viewportOffset = this.vterm.getViewportOffset();

    // Only recompute styled lines when content actually changed
    if (gen !== this._lastGeneration) {
      this._lastStyledLines = this.vterm.getStyledLines();
      this._lastGeneration = gen;
      this._lastCursorPos = cursorPos;
      this._lastCursorVisible = cursorVisible;
      this._lastViewportOffset = viewportOffset;
    }

    const styledLines = this._lastStyledLines;
    const lastCursorPos = this._lastCursorPos;
    const lastCursorVisible = this._lastCursorVisible;
    const lastViewportOffset = this._lastViewportOffset;

    const cursorInViewport = lastCursorVisible &&
      lastViewportOffset === 0 &&
      lastCursorPos.y >= 0 &&
      lastCursorPos.y < this.vterm.rows &&
      lastCursorPos.x < this.vterm.cols;

    for (let i = 0; i < styledLines.length && i < height; i++) {
      const lineChunks = (styledLines[i] as any).chunks ?? [];
      let x = 0;

      for (const chunk of lineChunks) {
        const text: string = chunk.text ?? '';
        if (text.length === 0) continue;

        const fg = chunk.fg ? parseColor(chunk.fg) : DEFAULT_FG;
        const bg = chunk.bg ? parseColor(chunk.bg) : DEFAULT_BG;

        const isCursorLine = cursorInViewport && i === lastCursorPos.y;
        const textWidth = this.vterm.getDisplayWidth(text);
        const cursorInChunk = isCursorLine && lastCursorPos.x >= x && lastCursorPos.x < x + textWidth;

        if (cursorInChunk) {
          const cursorOffset = lastCursorPos.x - x;
          if (cursorOffset > 0) {
            buffer.drawText(text.substring(0, cursorOffset), sx + x, sy + i, fg, bg);
          }
          buffer.drawText(text[cursorOffset], sx + x + cursorOffset, sy + i, bg, fg);
          const afterStart = cursorOffset + 1;
          if (afterStart < text.length) {
            buffer.drawText(text.substring(afterStart), sx + x + afterStart, sy + i, fg, bg);
          }
        } else {
          buffer.drawText(text, sx + x, sy + i, fg, bg);
        }
        x += textWidth;
      }
    }

    // Draw selection highlights
    if (this._selectionAnchor && this._selectionFocus) {
      const startRow = Math.min(this._selectionAnchor.row, this._selectionFocus.row);
      const endRow = Math.max(this._selectionAnchor.row, this._selectionFocus.row);
      const startCol = this._selectionAnchor.row < this._selectionFocus.row
        ? this._selectionAnchor.col
        : this._selectionAnchor.row > this._selectionFocus.row
          ? this._selectionFocus.col
          : Math.min(this._selectionAnchor.col, this._selectionFocus.col);
      const endCol = this._selectionAnchor.row < this._selectionFocus.row
        ? this._selectionFocus.col
        : this._selectionAnchor.row > this._selectionFocus.row
          ? this._selectionAnchor.col
          : Math.max(this._selectionAnchor.col, this._selectionFocus.col);

      const selBg = parseColor('#4a90d9');
      const selFg = parseColor('#ffffff');

      for (let row = startRow; row <= endRow && row < height; row++) {
        const lineStart = row === startRow ? startCol : 0;
        const lineEnd = row === endRow ? endCol : (this.vterm?.cols ?? 1) - 1;
        const lineText = this.vterm?.getLineText(row) ?? '';

        let x = 0;
        for (let charIdx = 0; charIdx < lineText.length && x <= lineEnd; charIdx++) {
          if (x >= lineStart) {
            buffer.drawText(lineText[charIdx] || ' ', sx + x, sy + row, selFg, selBg);
          }
          x += this.vterm?.getDisplayWidth(lineText[charIdx]) ?? 1;
        }
      }
    }
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
