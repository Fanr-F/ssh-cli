import { describe, expect, test } from 'bun:test';
import { clampPopupPosition } from '../../src/ui/help-popup';

describe('help popup geometry', () => {
  test('keeps the popup fully inside the terminal', () => {
    // The popup is 50% wide and 80% tall: max left 50%, max top 20%.
    expect(clampPopupPosition(80, 90)).toEqual({ left: 50, top: 20 });
    expect(clampPopupPosition(-10, -5)).toEqual({ left: 0, top: 0 });
  });

  test('keeps valid positions unchanged', () => {
    expect(clampPopupPosition(25, 10)).toEqual({ left: 25, top: 10 });
  });

  test('clamps each axis independently', () => {
    expect(clampPopupPosition(60, 5)).toEqual({ left: 50, top: 5 });
    expect(clampPopupPosition(10, 40)).toEqual({ left: 10, top: 20 });
  });
});
