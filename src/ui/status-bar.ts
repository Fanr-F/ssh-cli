import { Box, Text, type CliRenderer } from "@opentui/core";

/**
 * StatusBarAPI provides methods to update the status bar display.
 */
export interface StatusBarAPI {
  /** Update left-side status text */
  setStatus(text: string): void;
  /** Show "Connected to {host}" in green */
  setConnected(host: string): void;
  /** Show "Disconnected" in gray */
  setDisconnected(): void;
  /** Update right-side keybinding hints (accept string[] and join with " | ") */
  setKeybindings(hints: string[]): void;
}

/**
 * Create a bottom status bar for the SSH TUI client.
 *
 * The status bar is a 1-row, fixed-position bar at the bottom of the screen
 * with a left section for connection status and a right section for
 * keybinding hints.
 *
 * @param renderer - The CliRenderer instance to attach the status bar to
 * @returns An API object for controlling the status bar dynamically
 */
export function createStatusBar(renderer: CliRenderer): StatusBarAPI {
  // --- Create text elements ---

  const statusText = Text({
    content: "Disconnected",
    fg: "#9CA3AF", // gray-400
  });

  const hintsText = Text({
    content: "",
    fg: "#6B7280", // gray-500
  });

  // --- Create status bar container ---

  const statusBar = Box(
    {
      position: "absolute",
      bottom: 0,
      width: "100%",
      height: 1,
      backgroundColor: "#1f2937", // gray-800
      flexDirection: "row",
      justifyContent: "space-between",
      paddingX: 1,
    },
    statusText,
    hintsText,
  );

  // --- Attach to renderer ---

  renderer.root.add(statusBar);

  // VNode proxies forward property access to the underlying renderable
  // instances at runtime. We cast through a minimal interface to match
  // the setter parameter types that TextRenderable accepts.
  const st = statusText as unknown as { content: string; fg: string };
  const ht = hintsText as unknown as { content: string };

  // --- API ---

  return {
    setStatus(text: string): void {
      st.content = text;
    },

    setConnected(host: string): void {
      st.content = `Connected to ${host}`;
      st.fg = "#22C55E"; // green-500
    },

    setDisconnected(): void {
      st.content = "Disconnected";
      st.fg = "#9CA3AF"; // gray-400
    },

    setKeybindings(hints: string[]): void {
      ht.content = hints.join(" | ");
    },
  };
}
