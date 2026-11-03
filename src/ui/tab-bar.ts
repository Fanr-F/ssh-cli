import { Box, Text } from '@opentui/core';
import type { CliRenderer, MouseEvent } from '@opentui/core';
import { createLogger } from '../logger';
import { theme } from '../theme';

const log = createLogger('tab-bar');

// ── Tokyo Night palette ───────────────────────────────────────
const C = {
  bg: theme.appBg,
  bgActive: theme.elevatedBg,
  bgHover: theme.hoverBg,
  border: theme.border,
  borderActive: theme.focusBorder,
  text: theme.textSecondary,
  textActive: theme.text,
  textDim: theme.textDim,
  cyan: theme.cyan,
  blue: theme.accent,
};

export interface TabBarAPI {
  readonly component: ReturnType<typeof Box>;
  addTab(id: string, title: string, type: 'terminal' | 'sftp'): void;
  removeTab(id: string): void;
  switchTo(id: string): void;
  getActiveTabId(): string | null;
  getTabIds(): string[];
  getTabType(id: string): 'terminal' | 'sftp' | null;
  updateTabTitle(id: string, title: string): void;
  onTabSwitch(callback: (id: string) => void): void;
  onTabClose(callback: (id: string) => void): void;
  setVisible(visible: boolean): void;
}

export function createTabBar(renderer: CliRenderer): TabBarAPI {
  let tabs: Array<{ id: string; title: string; type: 'terminal' | 'sftp' }> = [];
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
  /** True when tabs were added/removed before the bar was mounted. */
  let needsRebuild = false;

  /** Resolved nodes per tab, so title/active changes never rebuild the tree. */
  interface TabNodes {
    box: any;
    title: any;
    close: any;
  }
  const nodeRefs = new Map<string, TabNodes>();

  function buildChildren(): ReturnType<typeof Box>[] {
    return tabs.map((tab) => {
      const isActive = tab.id === activeTabId;
      return Box(
        {
          id: `tab-${tab.id}`,
          flexDirection: 'row',
          paddingX: 1,
          backgroundColor: isActive ? C.bgActive : C.bg,
          // NOTE: this was `borderBottom: <color>`, which is not an OpenTUI Box option and
          // was silently ignored. A real bottom border (`border: ['bottom']`) would consume
          // the single row this 1-high tab bar has and clip the tab titles, so the active
          // tab stays indicated by its background colour only.
          onMouseDown: (e: MouseEvent) => {
            e.stopPropagation();
            const now = Date.now();
            const isDoubleClick = tab.id === lastClickId && (now - lastClickTime) < DOUBLE_CLICK_MS;
            lastClickId = tab.id;
            lastClickTime = now;
            log.debug(`[TAB BAR] MouseDown: tab=${tab.id}, isDoubleClick=${isDoubleClick}`);

            if (isDoubleClick) {
              log.debug(`[TAB BAR] Double-click detected, closing tab ${tab.id}`);
              onCloseCb?.(tab.id);
            } else {
              log.debug(`[TAB BAR] Single-click, switching to tab ${tab.id}`);
              switchTo(tab.id);
            }
          },
        },
        Text({ id: `tab-title-${tab.id}`, content: ` ${tab.title} `, fg: isActive ? C.textActive : C.text }),
        Text({ id: `tab-close-${tab.id}`, content: '\u00D7', fg: isActive ? C.cyan : C.textDim }),
      );
    });
  }

  function resolveNodes(instance: any): void {
    nodeRefs.clear();
    for (const tab of tabs) {
      const box = instance.findDescendantById(`tab-${tab.id}`);
      const title = instance.findDescendantById(`tab-title-${tab.id}`);
      const close = instance.findDescendantById(`tab-close-${tab.id}`);
      if (box && title && close) nodeRefs.set(tab.id, { box, title, close });
    }
  }

  /** Update titles and active colours in place; O(tabs), no tree rebuild. */
  function applyTabStyles(): void {
    for (const tab of tabs) {
      const refs = nodeRefs.get(tab.id);
      if (!refs) continue;
      const isActive = tab.id === activeTabId;
      refs.box.backgroundColor = isActive ? C.bgActive : C.bg;
      refs.title.content = ` ${tab.title} `;
      refs.title.fg = isActive ? C.textActive : C.text;
      refs.close.fg = isActive ? C.cyan : C.textDim;
    }
  }

  /** Rebuild the tab row. Only needed when tabs are added or removed. */
  function rebuild(): void {
    const instance = getInstance();
    if (!instance) {
      // Tabs added before mounting: remember to rebuild once mounted.
      needsRebuild = true;
      return;
    }
    needsRebuild = false;

    // Remove every tab node; the model above is the source of truth for what
    // should exist, so stale tabs cannot survive a rebuild.
    for (const child of [...(instance.getChildren() ?? [])]) {
      if (typeof child.id === 'string' && child.id.startsWith('tab-')) {
        instance.remove(child);
      }
    }

    for (const child of buildChildren()) {
      instance.add(child);
    }

    resolveNodes(instance);
    applyTabStyles();
    renderer.requestRender();
  }

  function ensureRebuilt(): void {
    if (needsRebuild && getInstance()) rebuild();
  }

  function switchTo(id: string): void {
    log.debug(`[TAB BAR] switchTo called: id=${id}, current activeTabId=${activeTabId}`);
    if (activeTabId === id) {
      log.debug(`[TAB BAR] switchTo: already active, returning`);
      return;
    }
    activeTabId = id;
    ensureRebuilt();
    applyTabStyles();
    renderer.requestRender();
    log.debug(`[TAB BAR] switchTo: calling onSwitchCb for ${id}`);
    onSwitchCb?.(id);
  }

  // ── Public API ──────────────────────────────────────────────
  const api: TabBarAPI = {
    component: tabBar,

    addTab(id: string, title: string, type: 'terminal' | 'sftp'): void {
      if (tabs.find((t) => t.id === id)) return;
      tabs.push({ id, title, type });
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

    getTabType(id: string): 'terminal' | 'sftp' | null {
      const tab = tabs.find((t) => t.id === id);
      return tab ? tab.type : null;
    },

    updateTabTitle(id: string, title: string): void {
      const tab = tabs.find((t) => t.id === id);
      if (!tab || tab.title === title) return;
      tab.title = title;
      ensureRebuilt();
      applyTabStyles();
      renderer.requestRender();
    },

    onTabSwitch(callback: (id: string) => void): void {
      onSwitchCb = callback;
    },

    onTabClose(callback: (id: string) => void): void {
      onCloseCb = callback;
    },

    setVisible(visible: boolean): void {
      ensureRebuilt();
      const instance = getInstance();
      if (instance) instance.visible = visible;
    },
  };

  return api;
}
