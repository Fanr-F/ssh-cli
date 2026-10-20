import { ScrollBox, SelectRenderable } from '@opentui/core';
import type { CliRenderer, MouseEvent } from '@opentui/core';
import type { ConnectionConfig } from '../types/connection';

// ── Public API ──────────────────────────────────────────────────────────────

export interface SidebarAPI {
  /** Replace the entire connection list. Resets selection to index 0. */
  setConnections(connections: ConnectionConfig[]): void;
  /** Return the currently selected connection, or null if the list is empty. */
  getSelectedConnection(): ConnectionConfig | null;
  /** Move selection one item down. Stops at the end – does NOT wrap. */
  selectNext(): void;
  /** Move selection one item up. Stops at the beginning – does NOT wrap. */
  selectPrevious(): void;
  /** Register a callback fired whenever the selected connection changes. */
  onConnectionSelect(callback: (conn: ConnectionConfig) => void): void;
  /**
   * Register a callback fired when an action should be performed on a
   * connection (e.g. 'connect', 'edit', 'delete').
   */
  onAction(callback: (action: string, conn: ConnectionConfig) => void): void;
  /** Set the focusable state on the real renderable (Proxy-safe). */
  setFocusable(value: boolean): void;
  /** Set visual focus highlight (changes border color). */
  setFocused(value: boolean): void;
  /** Set the sidebar width (triggers re-render). */
  setWidth(value: number): void;
  /** Get the current sidebar width. */
  getWidth(): number;
}

// ── Colour tokens (Tokyo Night) ────────────────────────────────────────────

const BG_SIDEBAR = '#16161e';
const BG_SELECTED = '#1f2335';
const BORDER = '#3b4261';
const BORDER_ACTIVE = '#7aa2f7';
const TITLE = '#7aa2f7';
const TEXT_SELECTED = '#c0caf5';
const TEXT_NORMAL = '#a9b1d6';
const TEXT_DIM = '#565f89';

/** Rows per connection entry: name line + user@host line. */
const ITEM_LINES = 2;
const DOUBLE_CLICK_MS = 300;

// ── Factory ─────────────────────────────────────────────────────────────────

export function createSidebar(
  renderer: CliRenderer,
  connections: ConnectionConfig[] = [],
): ReturnType<typeof ScrollBox> & SidebarAPI {
  // ── Internal state ──────────────────────────────────────────────────────

  let items: ConnectionConfig[] = [...connections];

  // The Select renders every entry itself; keeping its height at
  // items × ITEM_LINES means it never scrolls internally (scrollOffset
  // stays 0) and the surrounding ScrollBox owns scrolling.
  const select = new SelectRenderable(renderer.root.ctx, {
    id: 'sidebar-list',
    width: '100%',
    height: Math.max(1, items.length * ITEM_LINES),
    options: items.map(toOption),
    showDescription: true,
    showSelectionIndicator: false,
    showScrollIndicator: false,
    wrapSelection: false,
    backgroundColor: BG_SIDEBAR,
    focusedBackgroundColor: BG_SIDEBAR,
    textColor: TEXT_NORMAL,
    focusedTextColor: TEXT_NORMAL,
    selectedBackgroundColor: BG_SELECTED,
    selectedTextColor: TEXT_SELECTED,
    descriptionColor: TEXT_DIM,
    selectedDescriptionColor: TEXT_DIM,
    onMouseDown: handleMouseDown,
  });
  // Keyboard is routed by App (global shortcuts); the list must not consume it.
  select.focusable = false;

  // Box() returns a Proxy that queues add/remove to __pendingCalls.
  // After instantiation those calls go nowhere.  We resolve the real
  // renderable instance once the sidebar is mounted in the render tree.
  let _instance: any = null;
  function getInstance(): any {
    if (!_instance) {
      _instance = renderer.root.findDescendantById('sidebar');
    }
    return _instance;
  }

  let onSelectCb: ((conn: ConnectionConfig) => void) | null = null;
  let onActionCb: ((action: string, conn: ConnectionConfig) => void) | null = null;

  let lastClickIndex = -1;
  let lastClickTime = 0;

  // ── Logic ───────────────────────────────────────────────────────────────

  function toOption(conn: ConnectionConfig): { name: string; description: string } {
    const dot = conn.lastConnectedAt ? '\u25CF' : '\u25CB'; // ●  ○
    return {
      name: ` ${dot} ${conn.name}`,
      description: `  ${conn.username}@${conn.host}:${conn.port}`,
    };
  }

  function fireSelection(): void {
    const conn = items[select.getSelectedIndex()];
    if (conn && onSelectCb) {
      onSelectCb(conn);
    }
  }

  /** Keep the selected entry inside the ScrollBox viewport. */
  function ensureVisible(index: number): void {
    const scroll = getInstance();
    if (!scroll) return;
    const viewport = Math.max(1, Math.floor(scroll.viewport?.height || scroll.height || 1));
    const top = index * ITEM_LINES;
    const bottom = top + ITEM_LINES;
    if (top < scroll.scrollTop) {
      scroll.scrollTo(top);
    } else if (bottom > scroll.scrollTop + viewport) {
      scroll.scrollTo(bottom - viewport);
    }
  }

  /** Select an entry by index; `notify` mirrors the old explicit fireSelection(). */
  function selectIndex(index: number, notify: boolean): void {
    if (items.length === 0) return;
    const clamped = Math.max(0, Math.min(items.length - 1, index));
    select.setSelectedIndex(clamped);
    ensureVisible(clamped);
    if (notify) fireSelection();
  }

  function handleMouseDown(e: MouseEvent): void {
    if (items.length === 0) return;
    const index = Math.floor((e.y - select.screenY) / ITEM_LINES);
    if (index < 0 || index >= items.length) return;
    e.stopPropagation();

    const now = Date.now();
    const isDoubleClick = index === lastClickIndex && (now - lastClickTime) < DOUBLE_CLICK_MS;
    lastClickIndex = index;
    lastClickTime = now;

    selectIndex(index, true);
    if (onActionCb) {
      onActionCb(isDoubleClick ? 'connect' : 'select', items[index]);
    }
  }

  // ── Build the sidebar Box VNode ─────────────────────────────────────────

  const sidebarBox = ScrollBox(
    {
      id: 'sidebar',
      width: 30,
      backgroundColor: BG_SIDEBAR,
      borderStyle: 'rounded',
      borderColor: BORDER,
      title: ' Connections ',
      titleColor: TITLE,
      flexDirection: 'column',
      padding: 0,
      scrollY: true,
      scrollX: false,
      stickyScroll: false,
      contentOptions: { flexDirection: 'column' },
    },
    select,
  );

  // ── Public API ──────────────────────────────────────────────────────────

  const api: SidebarAPI = {
    setConnections(newConnections: ConnectionConfig[]): void {
      items = [...newConnections];
      select.options = items.map(toOption);
      select.height = Math.max(1, items.length * ITEM_LINES);
      select.setSelectedIndex(0);
      const scroll = getInstance();
      if (scroll) scroll.scrollTo(0);
    },

    getSelectedConnection(): ConnectionConfig | null {
      if (items.length === 0) return null;
      return items[select.getSelectedIndex()] ?? null;
    },

    selectNext(): void {
      const current = select.getSelectedIndex();
      if (current < items.length - 1) {
        selectIndex(current + 1, true);
      }
    },

    selectPrevious(): void {
      const current = select.getSelectedIndex();
      if (current > 0) {
        selectIndex(current - 1, true);
      }
    },

    onConnectionSelect(callback: (conn: ConnectionConfig) => void): void {
      onSelectCb = callback;
    },

    onAction(callback: (action: string, conn: ConnectionConfig) => void): void {
      onActionCb = callback;
    },

    setFocusable(value: boolean): void {
      const instance = getInstance();
      if (instance) instance.focusable = value;
    },

    setFocused(value: boolean): void {
      const instance = getInstance();
      if (instance) instance.borderColor = value ? BORDER_ACTIVE : BORDER;
    },

    setWidth(value: number): void {
      const instance = getInstance();
      if (instance) instance.width = value;
    },

    getWidth(): number {
      const instance = getInstance();
      return instance?.width ?? 30;
    },
  };

  return Object.assign(sidebarBox, api);
}
