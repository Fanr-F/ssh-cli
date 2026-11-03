/**
 * Tokyo Night design tokens.
 *
 * Every colour used by the TUI lives here. Components should reference a
 * semantic token (`theme.focusBorder`, `theme.panelBg`, …) instead of
 * hard-coding a hex value, so a palette change only touches one file.
 */
export const palette = {
  /** Application/rail background. */
  bg: '#16161e',
  /** Panels, terminals and input fields. */
  surface: '#1a1b26',
  /** Selected/hovered rows and active tabs. */
  surfaceActive: '#1f2335',
  /** Subtle hover state for interactive rows. */
  surfaceHover: '#292e42',
  /** Inactive borders. */
  border: '#3b4261',
  /** Focused borders and primary accents. */
  borderActive: '#7aa2f7',
  /** Primary text. */
  text: '#c0caf5',
  /** Secondary text (tab labels, help body). */
  textNormal: '#a9b1d6',
  /** Muted labels and hints. */
  textDim: '#565f89',
  /** Disabled/pressed hints. */
  textMuted: '#414868',
  blue: '#7aa2f7',
  cyan: '#7dcfff',
  green: '#9ece6a',
  yellow: '#e0af68',
  red: '#f7768e',
  magenta: '#bb9af7',
  /** Selected list row background. */
  selection: '#33467c',
  /** Dedicated status-bar/scrollbar track background. */
  statusBar: '#24283b',
  /** Modal scrim (black at ~80% opacity). */
  overlay: '#000000cc',
} as const;

/** Semantic aliases used by the UI components. */
export const theme = {
  palette,
  appBg: palette.bg,
  panelBg: palette.surface,
  elevatedBg: palette.surfaceActive,
  hoverBg: palette.surfaceHover,
  border: palette.border,
  focusBorder: palette.borderActive,
  accent: palette.blue,
  text: palette.text,
  textSecondary: palette.textNormal,
  textDim: palette.textDim,
  textMuted: palette.textMuted,
  cyan: palette.cyan,
  green: palette.green,
  yellow: palette.yellow,
  red: palette.red,
  magenta: palette.magenta,
  selectionBg: palette.selection,
  statusBarBg: palette.statusBar,
  overlay: palette.overlay,
} as const;

export type Theme = typeof theme;
