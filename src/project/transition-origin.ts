export interface PendingTransition {
  rect: { x: number; y: number; width: number; height: number };
  startIndex: number;
  /** Material opacity of the clicked plane at click time — the overlay image starts here. */
  opacity: number;
  /** Registry key of the clicked plane, used to hide exactly that plane (the same
   *  image URL can be shown by several planes at once) during the transition. */
  sourceKey: string | null;
}

let staged: { key: string; opacity: number } | null = null;
let pending: PendingTransition | null = null;
let hiddenKey: string | null = null;

/** Called by the clicked MediaPlane, synchronously before onMediaClick fires. */
export function stageTransitionSource(key: string, opacity: number): void {
  staged = { key, opacity };
}

export function setPendingTransition(
  rect: { x: number; y: number; width: number; height: number },
  startIndex: number,
): void {
  pending = { rect, startIndex, opacity: staged?.opacity ?? 1, sourceKey: staged?.key ?? null };
  staged = null;
}

export function consumePendingTransition(): PendingTransition | null {
  const p = pending;
  pending = null;
  return p;
}

/** Hide the source plane once the overlay image is painted exactly over it. */
export function hideTransitionSource(key: string | null): void {
  hiddenKey = key;
}

/** Un-hide the source plane — it fades back in via its normal opacity lerp. */
export function releaseTransitionSource(): void {
  hiddenKey = null;
}

export function isPlaneHidden(key: string): boolean {
  return hiddenKey === key;
}
