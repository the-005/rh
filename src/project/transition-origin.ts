export interface TransitionRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface PendingTransition {
  rect: TransitionRect;
  startIndex: number;
  /** Registry key of the clicked plane (the same image URL can be shown by
   *  several planes at once, so the plane is addressed by identity, not URL). */
  sourceKey: string | null;
}

interface HeroTween {
  key: string;
  /** Destination slot rect in screen pixels, measured from the project-page DOM. */
  target: TransitionRect;
  durationMs: number;
  done: boolean;
  onArrive: (() => void) | null;
}

let staged: string | null = null;
let pending: PendingTransition | null = null;
let heroTween: HeroTween | null = null;
let hiddenKey: string | null = null;
/** True from click until the project page fully releases the canvas: freezes
 *  input, dims non-hero planes, and tints the scene background. */
let active = false;

/** Called by the clicked MediaPlane, synchronously before onMediaClick fires. */
export function stageTransitionSource(key: string): void {
  staged = key;
}

export function setPendingTransition(rect: TransitionRect, startIndex: number): void {
  pending = { rect, startIndex, sourceKey: staged };
  staged = null;
  active = true;
}

export function consumePendingTransition(): PendingTransition | null {
  const p = pending;
  pending = null;
  return p;
}

/** Fly the source plane (in-scene) to the given screen rect. The plane itself
 *  performs the tween in its frame loop and stays pinned there afterwards. */
export function beginHeroTween(
  key: string,
  target: TransitionRect,
  durationMs: number,
  onArrive: () => void,
): void {
  heroTween = { key, target, durationMs, done: false, onArrive };
}

export function getHeroTween(key: string): HeroTween | null {
  return heroTween && heroTween.key === key ? heroTween : null;
}

/** Hide the source plane once the overlay image is painted exactly over it. */
export function hideTransitionSource(key: string | null): void {
  hiddenKey = key;
}

export function isPlaneHidden(key: string): boolean {
  return hiddenKey === key;
}

/** Every plane except the flying hero fades out while a transition is active. */
export function isDimmedPlane(key: string): boolean {
  return active && heroTween !== null && heroTween.key !== key;
}

export function isCanvasFrozen(): boolean {
  return active;
}

/** Re-assert an in-flight transition on mount. StrictMode double-invokes effects,
 *  and the intervening cleanup runs releaseTransition — this undoes that. */
export function holdTransition(): void {
  active = true;
}

/** End the transition: un-hide, un-dim, un-freeze — the canvas comes back to life. */
export function releaseTransition(): void {
  staged = null;
  pending = null;
  heroTween = null;
  hiddenKey = null;
  active = false;
}
