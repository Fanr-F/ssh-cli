import { Box, Text, ScrollBox, TextAttributes } from '@opentui/core';
import type { CliRenderer, MouseEvent } from '@opentui/core';
import { buildDocs } from '../keymap';

// ── Tokyo Night palette ───────────────────────────────────────
const C = {
  bg: '#1a1b26',
  bgOverlay: '#16161e',
  border: '#3b4261',
  text: '#a9b1d6',
  textDim: '#565f89',
  textActive: '#c0caf5',
  cyan: '#7dcfff',
  green: '#9ece6a',
  yellow: '#e0af68',
  red: '#f7768e',
  magenta: '#bb9af7',
};

export interface HelpPopupAPI {
  /** Root Box renderable */
  readonly component: ReturnType<typeof Box>;
  /** Show the help popup */
  show(): void;
  /** Hide the help popup */
  hide(): void;
  /** Toggle visibility */
  toggle(): void;
  /** Check if visible */
  isVisible(): boolean;
  /** Scroll content up by `step` lines */
  scrollUp(step?: number): void;
  /** Scroll content down by `step` lines */
  scrollDown(step?: number): void;
}

export function createHelpPopup(renderer: CliRenderer): HelpPopupAPI {
  let visible = false;

  // Resolve real renderable
  let _instance: any = null;
  function getInstance(): any {
    if (!_instance) {
      _instance = renderer.root.findDescendantById('help-popup');
    }
    return _instance;
  }

  // Resolve scroll box
  let _scrollInstance: any = null;
  function getScrollInstance(): any {
    if (!_scrollInstance) {
      const popup = getInstance();
      if (popup) {
        _scrollInstance = popup.findDescendantById('help-scroll');
      }
    }
    return _scrollInstance;
  }

  // ── Drag state ──────────────────────────────────────────────────
  let lastDragX = -1;
  let lastDragY = -1;

  // 帮助内容来自 keymap 的唯一事实来源
  const docs = buildDocs('en');

  /** 键名列宽按实际内容计算，避免硬编码 padEnd 造成错位。 */
  const keyWidth = docs.reduce(
    (max, group) => group.rows.reduce((m, row) => Math.max(m, row.keys.length), max),
    16,
  ) + 3;

  // Build the help content
  function buildContent(): ReturnType<typeof Box>[] {
    const lines: ReturnType<typeof Box>[] = [];

    // Title
    const titleBox = Box({
      paddingX: 1,
      paddingY: 1,
    });
    titleBox.add(Text({ content: 'Keyboard Shortcuts', fg: C.cyan, attributes: TextAttributes.BOLD }));
    lines.push(titleBox);

    // Separator
    const sepBox = Box({ height: 1, paddingX: 1 });
    sepBox.add(Text({ content: '─'.repeat(50), fg: C.border }));
    lines.push(sepBox);

    for (let ci = 0; ci < docs.length; ci++) {
      const group = docs[ci];

      // Separator between categories
      if (ci > 0) {
        const catSep = Box({ height: 1, paddingX: 1 });
        catSep.add(Text({ content: '─'.repeat(50), fg: C.border }));
        lines.push(catSep);
      }

      // Category header
      const catBox = Box({ paddingX: 1, paddingY: 1 });
      catBox.add(Text({ content: group.title, fg: C.yellow, attributes: TextAttributes.BOLD }));
      lines.push(catBox);

      const keyBox = Box({ paddingX: 2, paddingY: 0 });
      for (const row of group.rows) {
        const rowBox = Box({ height: 1, flexDirection: 'row' });
        rowBox.add(Text({ content: row.keys.padEnd(keyWidth), fg: C.green }));
        rowBox.add(Text({ content: row.text, fg: C.text }));
        keyBox.add(rowBox);
      }
      lines.push(keyBox);

      if (group.note) {
        const noteBox = Box({ paddingX: 2, paddingY: 0 });
        noteBox.add(Text({ content: group.note, fg: C.textDim }));
        lines.push(noteBox);
      }
    }

    // Footer
    const footBox = Box({ paddingX: 1, paddingY: 1 });
    footBox.add(
      Text({
        content: 'F1 or Esc: close   ↑/↓: scroll   PgUp/PgDn: page',
        fg: C.textDim,
      }),
    );
    lines.push(footBox);

    return lines;
  }

  function maxScrollTop(): number {
    const scrollBox = getScrollInstance();
    if (!scrollBox) return 0;
    const viewportHeight = Math.floor(scrollBox.viewport?.height ?? 0);
    return Math.max(0, (scrollBox.scrollHeight ?? 0) - viewportHeight);
  }

  function show(): void {
    visible = true;
    const instance = getInstance();
    if (instance) {
      instance.visible = true;
      // Reset scroll position
      const scrollBox = getScrollInstance();
      if (scrollBox) {
        scrollBox.scrollTop = 0;
      }
      renderer.requestRender();
    }
  }

  function hide(): void {
    visible = false;
    const instance = getInstance();
    if (instance) {
      instance.visible = false;
      renderer.requestRender();
    }
  }

  function scrollUp(step = 2): void {
    const scrollBox = getScrollInstance();
    if (scrollBox) {
      scrollBox.scrollTop = Math.max(0, scrollBox.scrollTop - step);
      renderer.requestRender();
    }
  }

  function scrollDown(step = 2): void {
    const scrollBox = getScrollInstance();
    if (scrollBox) {
      scrollBox.scrollTop = Math.min(maxScrollTop(), scrollBox.scrollTop + step);
      renderer.requestRender();
    }
  }

  // Build the popup container
  const contentLines = buildContent();
  const popup = Box(
    {
      id: 'help-popup',
      position: 'absolute',
      top: '10%',
      left: '25%',
      width: '50%',
      height: '80%',
      backgroundColor: C.bgOverlay,
      borderColor: C.border,
      flexDirection: 'column',
      padding: 1,
      visible: false,
      // ── Drag handler ────────────────────────────────────────────
      onMouseDrag: (e: MouseEvent) => {
        if (!visible) return;
        // Initialize on first drag event
        if (lastDragX === -1) {
          lastDragX = e.x;
          lastDragY = e.y;
          return;
        }
        // Calculate delta
        const deltaX = e.x - lastDragX;
        const deltaY = e.y - lastDragY;
        lastDragX = e.x;
        lastDragY = e.y;
        // Update position
        const instance = getInstance();
        if (instance) {
          const screenWidth = renderer.width ?? 80;
          const screenHeight = renderer.height ?? 24;
          const currentLeft = (parseFloat(String(instance.left)) / 100) * screenWidth;
          const currentTop = (parseFloat(String(instance.top)) / 100) * screenHeight;
          const newLeft = currentLeft + deltaX;
          const newTop = currentTop + deltaY;
          instance.left = `${Math.max(0, Math.min(80, (newLeft / screenWidth) * 100))}%`;
          instance.top = `${Math.max(0, Math.min(80, (newTop / screenHeight) * 100))}%`;
          renderer.requestRender();
        }
      },
    },
    ScrollBox(
      {
        id: 'help-scroll',
        flexGrow: 1,
        scrollY: true,
        scrollX: false,
        stickyScroll: false,
        contentOptions: { flexDirection: 'column' },
      },
      ...contentLines,
    ),
  );

  return {
    component: popup,

    show,
    hide,

    scrollUp,
    scrollDown,

    toggle: () => {
      if (visible) hide();
      else show();
    },

    isVisible: () => visible,
  };
}
