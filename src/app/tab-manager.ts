import type { EmbeddedTerminalRenderable } from '@opentui/core';
import type { ConnectionConfig } from '../types/connection';
import type { AltScreenTracker } from '../ssh/alt-screen';
import type { SshConnection } from '../ssh/connection';
import type { SftpClient } from '../sftp/sftp-client';
import type { SftpTabAPI } from '../sftp/sftp-tab';
import { logDebug } from '../logger';

/** One tab's runtime state (terminal tabs and SFTP tabs share the shape). */
export interface TabState {
  term: EmbeddedTerminalRenderable;
  ssh: SshConnection;
  config: ConnectionConfig;
  /** Remote alternate-screen state; SFTP tabs reuse the terminal tab's tracker. */
  altScreen: AltScreenTracker;
  sftpClient?: SftpClient;
  sftpTab?: SftpTabAPI;
}

/** UI operations the manager cannot perform itself. */
export interface TabManagerHooks {
  unregisterTerminal(id: string): void;
  /** Remove the SFTP component node from the right panel. */
  removeSftpNode(tab: TabState): void;
  removeTabFromBar(id: string): void;
  /** Called when the last tab is closed and the idle placeholder should show. */
  onAllTabsClosed(): void;
  requestRender(): void;
}

/**
 * Owns the tab map and the single teardown path.
 *
 * UI removal happens first so the app stays responsive while SSH shutdown
 * waits; `closing` prevents channel/connection close events from re-entering
 * the same teardown.
 */
export class TabManager {
  private readonly tabs = new Map<string, TabState>();
  private readonly closing = new Set<string>();

  constructor(private readonly hooks: TabManagerHooks) {}

  get size(): number {
    return this.tabs.size;
  }

  get(id: string): TabState | undefined {
    return this.tabs.get(id);
  }

  has(id: string): boolean {
    return this.tabs.has(id);
  }

  set(id: string, tab: TabState): void {
    this.tabs.set(id, tab);
  }

  values(): IterableIterator<TabState> {
    return this.tabs.values();
  }

  entries(): IterableIterator<[string, TabState]> {
    return this.tabs.entries();
  }

  /** Detach all tabs (shutdown) and return them for parallel disconnects. */
  clear(): TabState[] {
    const all = [...this.tabs.values()];
    this.tabs.clear();
    return all;
  }

  async dispose(id: string, options: { keepPanel?: boolean } = {}): Promise<void> {
    const tab = this.tabs.get(id);
    if (!tab || this.closing.has(id)) {
      logDebug(`[CLOSE TAB] id=${id} already gone or closing`);
      return;
    }

    logDebug(`[CLOSE TAB] id=${id}, isSftp=${!!tab.sftpTab}, ssh=${tab.ssh.isConnected()}`);
    this.closing.add(id);

    try {
      this.tabs.delete(id);

      if (tab.sftpTab) {
        try {
          tab.sftpTab.destroy();
        } catch (err) {
          logDebug(`[CLOSE TAB] SFTP destroy failed: ${err}`);
        }
        this.hooks.removeSftpNode(tab);
      } else {
        // Only terminal tabs register in the terminal panel.
        this.hooks.unregisterTerminal(id);
      }

      this.hooks.removeTabFromBar(id);
      logDebug(`[CLOSE TAB] removed ${id}, tabs remaining=${this.tabs.size}`);

      if (this.tabs.size === 0 && !options.keepPanel) {
        this.hooks.onAllTabsClosed();
      }

      this.hooks.requestRender();

      try {
        await tab.ssh.disconnect();
        logDebug(`[CLOSE TAB] SSH disconnected for ${id}`);
      } catch (err) {
        logDebug(`[CLOSE TAB] SSH disconnect failed for ${id}: ${err}`);
      }
    } finally {
      this.closing.delete(id);
      this.hooks.requestRender();
    }
  }
}
