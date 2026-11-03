import type { CliRenderer } from '@opentui/core';

/**
 * Minimal structural view of a node resolved from the render tree.
 *
 * `Box()`/`Text()` return VNode proxies; after mounting, the real renderables
 * are reached with `findDescendantById()`. Those instances are typed as `any`
 * inside OpenTUI, so this interface gives the app a checked surface and keeps
 * the unavoidable cast in exactly one place (`resolveNode`).
 */
export interface ResolvedNode {
  id?: string;
  visible: boolean;
  borderColor: string;
  backgroundColor?: string;
  width: number;
  height: number;
  left?: string | number;
  top?: string | number;
  content: unknown;
  fg: string;
  focusable: boolean;
  focused?: boolean;
  isDestroyed?: boolean;
  scrollTop: number;
  scrollHeight?: number;
  viewport?: { height?: number };
  parent?: { remove(child: ResolvedNode): void } | null;

  getChildren(): ResolvedNode[];
  add(child: unknown): void;
  remove(child: ResolvedNode): void;
  findDescendantById(id: string): ResolvedNode | undefined;
  scrollTo(y: number): void;
  focus(): void;
  blur(): void;
}

/** Resolve a node by id from the renderer root (or a supplied subtree root). */
export function resolveNode(
  renderer: CliRenderer,
  id: string,
  root?: ResolvedNode | null,
): ResolvedNode | null {
  const tree = root ?? (renderer.root as unknown as ResolvedNode);
  return tree.findDescendantById(id) ?? null;
}

/** Resolve a descendant id inside an already-resolved node. */
export function resolveDescendant(
  root: ResolvedNode | null | undefined,
  id: string,
): ResolvedNode | null {
  return root?.findDescendantById(id) ?? null;
}
