import { Box } from '@opentui/core';
import type { CliRenderer, MouseEvent } from '@opentui/core';

// ── Colour tokens (Tokyo Night) ────────────────────────────────────────────

const DIVIDER_BG = '#3b4261';
const DIVIDER_HOVER = '#565f89';
const MIN_SIDEBAR_WIDTH = 15;
const MAX_SIDEBAR_WIDTH = 80;

// ── Factory ─────────────────────────────────────────────────────────────────

export function createDivider(
  renderer: CliRenderer,
  onResize: (newWidth: number) => void,
  getSidebarWidth: () => number,
): ReturnType<typeof Box> {
  let isDragging = false;
  let dragStartX = 0;
  let dragStartWidth = 0;

  // Resolve real renderable instance for Proxy-safe property sets.
  let _instance: any = null;
  function getInstance(): any {
    if (!_instance) {
      _instance = renderer.root.findDescendantById('divider');
    }
    return _instance;
  }

  const divider = Box({
    id: 'divider',
    width: 1,
    height: '100%',
    backgroundColor: DIVIDER_BG,
    onMouseDown: (e: MouseEvent) => {
      e.stopPropagation();
      isDragging = true;
      dragStartX = e.x;
      dragStartWidth = getSidebarWidth();
      const inst = getInstance();
      if (inst) inst.backgroundColor = DIVIDER_HOVER;
      renderer.requestRender();
    },
    onMouseDrag: (e: MouseEvent) => {
      if (!isDragging) return;
      e.stopPropagation();
      const delta = e.x - dragStartX;
      const newWidth = Math.min(MAX_SIDEBAR_WIDTH, Math.max(MIN_SIDEBAR_WIDTH, dragStartWidth + delta));
      onResize(newWidth);
    },
    onMouseDragEnd: (_e: MouseEvent) => {
      if (!isDragging) return;
      isDragging = false;
      const inst = getInstance();
      if (inst) inst.backgroundColor = DIVIDER_BG;
      renderer.requestRender();
    },
  });

  return divider;
}
