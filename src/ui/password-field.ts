import { StyledText, type TextChunk } from '@opentui/core';
import { toRGBA } from '../color';
import { theme } from '../theme';

/** Create a StyledText from a plain string with optional per-character styling. */
export function makeStyledText(text: string, fg: string = theme.text): StyledText {
  const chunks: TextChunk[] = [];
  const color = toRGBA(fg);
  for (const char of text) {
    chunks.push({ __isChunk: true, text: char, fg: color, attributes: 0 });
  }
  return new StyledText(chunks);
}

/** Create StyledText with the character at `pos` highlighted as a cursor. */
export function createStyledWithCursor(
  text: string,
  pos: number,
  fg: string = theme.text,
): StyledText {
  const chunks: TextChunk[] = [];
  const fieldFg = toRGBA(fg);
  const cursorFg = toRGBA(theme.panelBg);
  const cursorBg = toRGBA(theme.accent);
  for (let i = 0; i < text.length; i++) {
    if (i === pos) {
      chunks.push({ __isChunk: true, text: text[i], fg: cursorFg, bg: cursorBg, attributes: 0 });
    } else {
      chunks.push({ __isChunk: true, text: text[i], fg: fieldFg, attributes: 0 });
    }
  }
  // When the cursor sits at the end, render a trailing highlighted space.
  if (pos >= text.length && text.length > 0) {
    chunks.push({ __isChunk: true, text: ' ', fg: cursorFg, bg: cursorBg, attributes: 0 });
  }
  return new StyledText(chunks);
}
