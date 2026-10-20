import { parseColor, type RGBA } from "@opentui/core";

/**
 * Convert a color string (e.g. `"#1a1b26"`) into an OpenTUI {@link RGBA}.
 *
 * `TextChunk.fg` / `TextChunk.bg` are typed as `RGBA`. Up to @opentui/core 0.4.0 a
 * plain hex string was still tolerated (the encoder normalised it on the way in), but
 * since 0.6.x the chunk encoder dereferences the color's internal buffer directly and
 * throws `undefined is not an object (evaluating 'source[index]')`. Every StyledText
 * chunk color therefore has to be a real `RGBA` instance.
 *
 * Results are memoised because the terminal renderer reconverts colors for every dirty
 * row on every frame. The cache is capped so truecolor output cannot grow it forever.
 */
const MAX_CACHED_COLORS = 4096;
const colorCache = new Map<string, RGBA>();

export function toRGBA(color: string | RGBA | undefined | null): RGBA | undefined {
  if (color === undefined || color === null) return undefined;
  if (typeof color !== "string") return color;

  let rgba = colorCache.get(color);
  if (rgba === undefined) {
    rgba = parseColor(color);
    if (colorCache.size >= MAX_CACHED_COLORS) colorCache.clear();
    colorCache.set(color, rgba);
  }
  return rgba;
}
