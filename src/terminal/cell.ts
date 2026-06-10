import { Cell } from '../types/terminal';

/**
 * Create a default empty cell.
 */
export function createCell(): Cell {
  return {
    char: ' ',
    fg: null,
    bg: null,
    bold: false,
    dim: false,
    italic: false,
    underline: false,
    blink: false,
    reverse: false,
  };
}

/**
 * Convert a cell to its string representation.
 * For now, just returns the character.
 * In the future, if reverse video is set, the visual representation
 * would be swapped — kept as-is for now.
 */
export function cellToString(cell: Cell): string {
  return cell.char;
}

/**
 * Deep comparison of two cells for dirty tracking.
 * Returns true if all properties are equal.
 */
export function cellsEqual(a: Cell, b: Cell): boolean {
  return (
    a.char === b.char &&
    a.fg === b.fg &&
    a.bg === b.bg &&
    a.bold === b.bold &&
    a.dim === b.dim &&
    a.italic === b.italic &&
    a.underline === b.underline &&
    a.blink === b.blink &&
    a.reverse === b.reverse
  );
}
