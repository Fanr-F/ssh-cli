import { Box, Text, stringToStyledText } from '@opentui/core';
import type { CliRenderer, KeyEvent } from '@opentui/core';

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
      { key: 'Ctrl+Tab', action: 'Toggle focus (Sidebar ↔ Terminal)' },
      { key: 'F1', action: 'Show this help' },
    ],
  },
  {
    category: 'Sidebar',
    keys: [
      { key: '↑/↓', action: 'Navigate connections' },
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
    ],
  },
  {
    category: 'Tab Bar',
    keys: [
      { key: 'Click', action: 'Switch to tab' },
      { key: 'Double-click', action: 'Close tab' },
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
    const sepBox = Box({ paddingX: 1 });
    sepBox.add(Text({ content: '─'.repeat(50), fg: C.border }));
    lines.push(sepBox);

    // Shortcuts by category
    for (const category of SHORTCUTS) {
      // Category header
      const catBox = Box({ paddingX: 1, paddingY: 0 });
      catBox.add(Text({ content: `\n${category.category}`, fg: C.yellow, bold: true }));
      lines.push(catBox);

      // Keys
      for (const { key, action } of category.keys) {
        const keyBox = Box({ paddingX: 2, flexDirection: 'row' });
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
      width: '50%',
      height: '60%',
      backgroundColor: C.bgOverlay,
      borderColor: C.border,
      flexDirection: 'column',
      padding: 1,
      visible: false,
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
