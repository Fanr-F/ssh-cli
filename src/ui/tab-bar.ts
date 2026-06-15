import { Box, Text } from '@opentui/core';
import type { CliRenderer, MouseEvent } from '@opentui/core';
import { appendFileSync } from 'fs';

const LOG_FILE = 'ssh-cli-debug.log';
function log(msg: string) {
  try { appendFileSync(LOG_FILE, `[${new Date().toISOString()}] ${msg}\n`); } catch {}
}

// ── Tokyo Night palette ───────────────────────────────────────
const C = {
  bg: '#16161e',
  bgActive: '#1f2335',
  bgHover: '#292e42',
  border: '#3b4261',
  borderActive: '#7aa2f7',
  text: '#a9b1d6',
  textActive: '#c0caf5',
  textDim: '#565f89',
  cyan: '#7dcfff',
  blue: '#7aa2f7',
};

export interface TabBarAPI {
  readonly component: ReturnType<typeof Box>;
  addTab(id: string, title: string): void;
  removeTab(id: string): void;
  switchTo(id: string): void;
  getActiveTabId(): string | null;
  getTabIds(): string[];
  updateTabTitle(id: string, title: string): void;
  onTabSwitch(callback: (id: string) => void): void;
  onTabClose(callback: (id: string) => void): void;
  setVisible(visible: boolean): void;
}

export function createTabBar(renderer: CliRenderer): TabBarAPI {
  let tabs: Array<{ id: string; title: string }> = [];
  let activeTabId: string | null = null;
  let onSwitchCb: ((id: string) => void) | null = null;
  let onCloseCb: ((id: string) => void) | null = null;

  // Double-click tracking
  let lastClickId: string | null = null;
  let lastClickTime = 0;
  const DOUBLE_CLICK_MS = 300;

  // ── Build the tab bar VNode ─────────────────────────────────
  const tabBar = Box({
    id: 'tab-bar',
    flexDirection: 'row',
    width: '100%',
    height: 1,
    backgroundColor: C.bg,
    paddingX: 1,
  });

  // ── Resolve real renderable ─────────────────────────────────
  let _instance: any = null;
  function getInstance(): any {
    if (!_instance) {
      _instance = renderer.root.findDescendantById('tab-bar');
    }
    return _instance;
  }

  // ── Track child IDs for rebuild ─────────────────────────────
  let childIds: string[] = [];

  function buildChildren(): ReturnType<typeof Box>[] {
    return tabs.map((tab) => {
      const isActive = tab.id === activeTabId;
      return Box(
        {
          id: `tab-${tab.id}`,
          flexDirection: 'row',
          paddingX: 1,
          backgroundColor: isActive ? C.bgActive : undefined,
          borderBottom: isActive ? C.borderActive : C.border,
          onMouseDown: (e: MouseEvent) => {
            e.stopPropagation();
            const now = Date.now();
            const isDoubleClick = tab.id === lastClickId && (now - lastClickTime) < DOUBLE_CLICK_MS;
            lastClickId = tab.id;
            lastClickTime = now;
            log(`[TAB BAR] MouseDown: tab=${tab.id}, isDoubleClick=${isDoubleClick}`);

            if (isDoubleClick) {
              log(`[TAB BAR] Double-click detected, closing tab ${tab.id}`);
              onCloseCb?.(tab.id);
            } else {
              log(`[TAB BAR] Single-click, switching to tab ${tab.id}`);
              switchTo(tab.id);
            }
          },
        },
        Text({ content: ` ${tab.title} `, fg: isActive ? C.textActive : C.text }),
        Text({ content: '\u00D7', fg: isActive ? C.cyan : C.textDim }),
      );
    });
  }

  function rebuild(): void {
    const instance = getInstance();
    if (!instance) return;

    // Remove old children by ID
    for (const id of childIds) {
      instance.remove(id);
    }

    // Insert fresh children
    const fresh = buildChildren();
    for (const child of fresh) {
      instance.add(child);
    }

    childIds = tabs.map((tab) => `tab-${tab.id}`);
    renderer.requestRender();
  }

  function switchTo(id: string): void {
    log(`[TAB BAR] switchTo called: id=${id}, current activeTabId=${activeTabId}`);
    if (activeTabId === id) {
      log(`[TAB BAR] switchTo: already active, returning`);
      return;
    }
    activeTabId = id;
    rebuild();
    log(`[TAB BAR] switchTo: calling onSwitchCb for ${id}`);
    onSwitchCb?.(id);
  }

  // ── Public API ──────────────────────────────────────────────
  const api: TabBarAPI = {
    component: tabBar,

    addTab(id: string, title: string): void {
      if (tabs.find((t) => t.id === id)) return;
      tabs.push({ id, title });
      activeTabId = id;
      rebuild();
      onSwitchCb?.(id);
    },

    removeTab(id: string): void {
      const index = tabs.findIndex((t) => t.id === id);
      if (index === -1) return;
      tabs.splice(index, 1);

      // If we removed the active tab, switch to another
      if (activeTabId === id) {
        if (tabs.length > 0) {
          const newIndex = Math.min(index, tabs.length - 1);
          activeTabId = tabs[newIndex].id;
          onSwitchCb?.(activeTabId);
        } else {
          activeTabId = null;
        }
      }

      rebuild();
    },

    switchTo,

    getActiveTabId: () => activeTabId,

    getTabIds: () => tabs.map((t) => t.id),

    updateTabTitle(id: string, title: string): void {
      const tab = tabs.find((t) => t.id === id);
      if (tab) {
        tab.title = title;
        rebuild();
      }
    },

    onTabSwitch(callback: (id: string) => void): void {
      onSwitchCb = callback;
    },

    onTabClose(callback: (id: string) => void): void {
      onCloseCb = callback;
    },

    setVisible(visible: boolean): void {
      const instance = getInstance();
      if (instance) instance.visible = visible;
    },
  };

  return api;
}
