import { Box, Text } from '@opentui/core';
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
}

// ── Colour tokens (Tokyo Night) ────────────────────────────────────────────

const BG_SIDEBAR = '#16161e';
const BG_SELECTED = '#1f2335';
const BG_HOVER = '#292e42';
const BORDER = '#3b4261';
const BORDER_ACTIVE = '#7aa2f7';
const TITLE = '#7aa2f7';
const TEXT_SELECTED = '#c0caf5';
const TEXT_NORMAL = '#a9b1d6';
const TEXT_DIM = '#565f89';
const DOT_CONNECTED = '#9ece6a';
const DOT_DISCONNECTED = '#414868';

// ── Factory ─────────────────────────────────────────────────────────────────

export function createSidebar(
  _renderer: CliRenderer,
  connections: ConnectionConfig[] = [],
): ReturnType<typeof Box> & SidebarAPI {
  // ── Internal state ──────────────────────────────────────────────────────

  let items: ConnectionConfig[] = [...connections];
  let selectedIndex = 0;
  let onSelectCb: ((conn: ConnectionConfig) => void) | null = null;
  let onActionCb: ((action: string, conn: ConnectionConfig) => void) | null = null;

  // ── Connection item factory ─────────────────────────────────────────────

  const ITEM_HEIGHT = 2; // rows per connection item
  let lastClickIndex = -1;
  let lastClickTime = 0;
  const DOUBLE_CLICK_MS = 300;

  function createItemVNode(
    conn: ConnectionConfig,
    index: number,
  ): ReturnType<typeof Box> {
    const isSelected = index === selectedIndex;
    const isConnected = !!conn.lastConnectedAt;
    const dot = isConnected ? '\u25CF' : '\u25CB'; // ●  ○
    const dotColor = isConnected ? DOT_CONNECTED : DOT_DISCONNECTED;

    return Box(
      {
        id: `conn-${conn.id}`,
        flexDirection: 'column',
        paddingX: 1,
        paddingY: 0,
        backgroundColor: isSelected ? BG_SELECTED : undefined,
        onMouseDown: (e: MouseEvent) => {
          e.stopPropagation();
          const now = Date.now();
          const isDoubleClick = index === lastClickIndex && (now - lastClickTime) < DOUBLE_CLICK_MS;
          lastClickIndex = index;
          lastClickTime = now;

          selectedIndex = index;
          rebuild();
          fireSelection();

          if (isDoubleClick && onActionCb) {
            onActionCb('connect', conn);
          } else if (onActionCb) {
            onActionCb('select', conn);
          }
        },
      },
      Text({
        content: ` ${dot} ${conn.name}`,
        fg: isSelected ? TEXT_SELECTED : TEXT_NORMAL,
      }),
      Text({
        content: `  ${conn.username}@${conn.host}:${conn.port}`,
        fg: TEXT_DIM,
      }),
    );
  }

  // ── Rebuild children ────────────────────────────────────────────────────

  /** IDs of the children currently in the sidebar Box. */
  let childIds: string[] = [];

  /** Build a fresh set of child VNodes for the current state. */
  function buildChildren(): ReturnType<typeof Box>[] {
    return items.map((conn, i) => createItemVNode(conn, i));
  }

  /**
   * Replace all children in the sidebar Box with ones that reflect the
   * current internal state (selection, connection list).
   *
   * Works both **before** and **after** the VNode is added to the render tree
   * (i.e. instantiated):
   *
   * ─ Before instantiation – pending calls are queued, VNode children array
   *   is swapped so that instantiation starts with a clean slate.
   * ─ After  instantiation – proxied remove/add calls hit the actual
   *   BoxRenderable children directly.
   */
  function rebuild(): void {
    // Remove old children from the actual Renderable (after instantiation).
    for (const id of childIds) {
      try {
        (sidebarBox as any).remove(id);
      } catch {
        // Not instantiated yet – nothing to remove.
      }
    }

    // Swap the VNode children array so that before-instantiation never sees
    // stale children.
    sidebarBox.children = [];

    // Insert fresh children.
    const fresh = buildChildren();
    for (const child of fresh) {
      sidebarBox.add(child);
    }

    // Remember the new IDs for the next rebuild.
    childIds = items.map((c) => `conn-${c.id}`);
  }

  // ── Fire callbacks ──────────────────────────────────────────────────────

  function fireSelection(): void {
    const conn = items[selectedIndex];
    if (conn && onSelectCb) {
      onSelectCb(conn);
    }
  }

  // ── Build the sidebar Box VNode ─────────────────────────────────────────

  const sidebarBox = Box(
    {
      width: 30,
      flexGrow: 1,
      backgroundColor: BG_SIDEBAR,
      borderStyle: 'rounded',
      borderColor: BORDER,
      title: ' Connections ',
      titleColor: TITLE,
      flexDirection: 'column',
      padding: 0,
    },
    ...buildChildren(),
  );

  // Track the initial child IDs so rebuild() can clean them up later.
  childIds = items.map((c) => `conn-${c.id}`);

  // ── Public API ──────────────────────────────────────────────────────────

  const api: SidebarAPI = {
    setConnections(newConnections: ConnectionConfig[]): void {
      items = [...newConnections];
      selectedIndex = items.length > 0 ? 0 : -1;
      rebuild();
    },

    getSelectedConnection(): ConnectionConfig | null {
      if (items.length === 0 || selectedIndex < 0) return null;
      return items[selectedIndex] ?? null;
    },

    selectNext(): void {
      if (items.length === 0) return;
      const prev = selectedIndex;
      if (selectedIndex < items.length - 1) {
        selectedIndex++;
      }
      if (selectedIndex !== prev) {
        rebuild();
        fireSelection();
      }
    },

    selectPrevious(): void {
      if (items.length === 0) return;
      const prev = selectedIndex;
      if (selectedIndex > 0) {
        selectedIndex--;
      }
      if (selectedIndex !== prev) {
        rebuild();
        fireSelection();
      }
    },

    onConnectionSelect(callback: (conn: ConnectionConfig) => void): void {
      onSelectCb = callback;
    },

    onAction(callback: (action: string, conn: ConnectionConfig) => void): void {
      onActionCb = callback;
    },
  };

  return Object.assign(sidebarBox, api);
}
