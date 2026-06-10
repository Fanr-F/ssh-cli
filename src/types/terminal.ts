export interface Cell {
  char: string;
  fg: number | null;   // ANSI color index (0-255) or null (default)
  bg: number | null;   // ANSI color index (0-255) or null (default)
  bold: boolean;
  dim: boolean;
  italic: boolean;
  underline: boolean;
  blink: boolean;
  reverse: boolean;    // Reverse video
}

export interface CursorPosition {
  row: number;
  col: number;
  visible: boolean;
}

export interface ScreenBufferState {
  rows: number;
  cols: number;
  cursor: CursorPosition;
  grid: Cell[][];
  scrollback: Cell[][];  // Lines scrolled off the top
}
