import { Box, Text } from '@opentui/core';
import type { CliRenderer, MouseEvent } from '@opentui/core';

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

interface Shortcut {
  category: string;
  keys: Array<{ key: string; action: string }>;
}

const SHORTCUTS: Shortcut[] = [
  {
    category: 'General',
    keys: [
      { key: 'Ctrl+Q', action: 'Quit application' },
      { key: 'Alt+←/→', action: 'Switch focus (Sidebar ↔ Terminal)' },
      { key: 'F1', action: 'Show this help' },
    ],
  },
  {
    category: 'Sidebar',
    keys: [
      { key: 'Alt+↑/↓', action: 'Navigate connections (global)' },
      { key: '↑/↓', action: 'Navigate connections (when focused)' },
      { key: 'Enter', action: 'Connect to selected server' },
      { key: 'A', action: 'Add new connection' },
      { key: 'E', action: 'Edit selected connection' },
      { key: 'Delete', action: 'Delete selected connection' },
    ],
  },
  {
    category: 'Terminal',
    keys: [
      { key: 'Ctrl+C', action: 'Copy (sidebar: info, terminal: last line)' },
      { key: 'Ctrl+V', action: 'Paste (to terminal or form)' },
      { key: 'Ctrl+Shift+C', action: 'Close current tab' },
      { key: 'Ctrl+Shift+Tab', action: 'Cycle to next tab' },
      { key: 'F2-F12', action: 'Switch to tab 1-11' },
      { key: 'PageUp/PageDown', action: 'Scroll terminal output' },
    ],
  },
  {
    category: 'Tab Bar',
    keys: [
      { key: 'Double-click', action: 'Close tab' },
    ],
  },
  {
    category: 'Form',
    keys: [
      { key: 'Tab', action: 'Next field' },
      { key: 'Shift+Tab', action: 'Previous field' },
      { key: 'Home', action: 'Move cursor to start' },
      { key: 'End', action: 'Move cursor to end' },
    ],
  },
];

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

  // ── Drag state ──────────────────────────────────────────────────
  let lastDragX = -1;
  let lastDragY = -1;

  // Build the help content
  function buildContent(): ReturnType<typeof Box>[] {
    const lines: ReturnType<typeof Box>[] = [];

    // Title
    const titleBox = Box({
      paddingX: 1,
      paddingY: 1,
    });
    titleBox.add(Text({ content: 'Keyboard Shortcuts', fg: C.cyan, bold: true }));
    lines.push(titleBox);

    // Separator
    const sepBox = Box({ height: 1, paddingX: 1 });
    sepBox.add(Text({ content: '─'.repeat(50), fg: C.border }));
    lines.push(sepBox);

    // Shortcuts by category
    for (let ci = 0; ci < SHORTCUTS.length; ci++) {
      const category = SHORTCUTS[ci];

      // Separator between categories
      if (ci > 0) {
        const sepBox = Box({ height: 1, paddingX: 1 });
        sepBox.add(Text({ content: '─'.repeat(50), fg: C.border }));
        lines.push(sepBox);
      }

      // Category header
      const catBox = Box({ paddingX: 1, paddingY: 1 });
      catBox.add(Text({ content: category.category, fg: C.yellow, bold: true }));
      lines.push(catBox);

      // Keys
      for (const { key, action } of category.keys) {
        const keyBox = Box({ height: 1, paddingX: 2, flexDirection: 'row' });
        keyBox.add(Text({ content: key.padEnd(20), fg: C.green }));
        keyBox.add(Text({ content: action, fg: C.text }));
        lines.push(keyBox);
      }
    }

    // Footer
    const footBox = Box({ paddingX: 1, paddingY: 1 });
    footBox.add(Text({ content: '\nPress F1 or Esc to close', fg: C.textDim }));
    lines.push(footBox);

    return lines;
  }

  function show(): void {
    visible = true;
    const instance = getInstance();
    if (instance) {
      instance.visible = true;
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

  // Build the popup container
  const contentLines = buildContent();
  const popup = Box(
    {
      id: 'help-popup',
      position: 'absolute',
      top: '20%',
      left: '25%',
      width: '30%',
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
    ...contentLines,
  );

  return {
    component: popup,

    show,
    hide,

    toggle: () => {
      if (visible) hide();
      else show();
    },

    isVisible: () => visible,
  };
}
