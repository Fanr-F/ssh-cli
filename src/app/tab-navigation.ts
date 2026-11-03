/** Pure tab navigation helpers shared by keyboard actions. */

export function tabIdAt(ids: readonly string[], index: number): string | null {
  return index >= 0 && index < ids.length ? ids[index] : null;
}

/** Next tab, wrapping around. Returns null for an empty list. */
export function nextTabId(ids: readonly string[], currentId: string | null): string | null {
  if (ids.length === 0) return null;
  const currentIndex = currentId ? ids.indexOf(currentId) : -1;
  return ids[(currentIndex + 1) % ids.length];
}

/** Previous tab, wrapping to the last entry from the first (or from none). */
export function previousTabId(ids: readonly string[], currentId: string | null): string | null {
  if (ids.length === 0) return null;
  const currentIndex = currentId ? ids.indexOf(currentId) : -1;
  return ids[currentIndex <= 0 ? ids.length - 1 : currentIndex - 1];
}
