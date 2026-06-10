
## 2026-06-10: ScreenBuffer SGR normalization

- Changed setSGR in screen-buffer.ts to normalize 30-37→0-7, 40-47→0-7, 90-97→8-15, 100-107→8-15. This makes the stored fg/bg values match the Cell type's documented "ANSI color index (0-255)" spec, and is consistent with how 38;5;n already stores the raw index.
