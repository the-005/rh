import type { MediaItem } from "~/src/infinite-canvas/types";

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
  /** Screen-pixel rect measured from the project-page DOM. On the way in it is
   *  where the plane flies to; on the way out it is where it flies from. */
  target: TransitionRect;
  durationMs: number;
  /** "in" — canvas to the page. "out" — back to the plane's own canvas slot. */
  mode: "in" | "out";
  done: boolean;
  onArrive: (() => void) | null;
}

/** Where the camera should ease to while the hero flies home, so the image it
 *  is returning to ends up centred rather than wherever you left it. */
interface CameraGoal {
  x: number;
  y: number;
  start: number;
  durationMs: number;
  /** Captured on the first frame that reads it, not at creation. */
  from: { x: number; y: number; driftX: number; driftY: number } | null;
}

let staged: string | null = null;
let pending: PendingTransition | null = null;
let heroTween: HeroTween | null = null;
let hiddenKey: string | null = null;
/** True from click until the project page fully releases the canvas: freezes
 *  input, dims non-hero planes, and tints the scene background. */
let active = false;
let cameraGoal: CameraGoal | null = null;

/**
 * A project closes on whatever image you were looking at, and the plane you
 * opened it from takes that image home. The override is keyed by plane and
 * pinned to the depth cycle it was first read in (the plane fills that in), so
 * once the plane cycles on, its own pool takes over again.
 */
const mediaOverrides = new Map<string, { item: MediaItem; cycle: number | null }>();
let swapWaiter: { key: string; item: MediaItem; onReady: () => void } | null = null;
/** Where the plane flying home is on screen this frame, so the page's row can
 *  keep hugging it as it shrinks. */
let heroScreenRect: TransitionRect | null = null;

export function setHeroScreenRect(rect: TransitionRect | null): void {
  heroScreenRect = rect;
}

export function getHeroScreenRect(): TransitionRect | null {
  return heroScreenRect;
}

/** Put `item` on plane `key`; `onReady` fires once the plane is drawing it. */
export function swapTransitionSource(key: string, item: MediaItem, onReady: () => void): void {
  mediaOverrides.set(key, { item, cycle: null });
  swapWaiter = { key, item, onReady };
}

export function getMediaOverride(key: string, cycle: number): MediaItem | null {
  const o = mediaOverrides.get(key);
  if (!o) return null;
  if (o.cycle === null) o.cycle = cycle;
  if (o.cycle !== cycle) {
    mediaOverrides.delete(key);
    return null;
  }
  return o.item;
}

/** The plane calls this once it is drawing `item`; returns the waiter to fire, once. */
export function takeSwapWaiter(key: string, item: MediaItem): (() => void) | null {
  if (!swapWaiter || swapWaiter.key !== key || swapWaiter.item !== item) return null;
  const { onReady } = swapWaiter;
  swapWaiter = null;
  return onReady;
}

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
 *  performs the tween in its frame loop and stays pinned there afterwards.
 *  mode "out" reverses it: the plane re-pins to `target` (wherever the row has
 *  since carried the image) and flies home to the canvas slot it came from. */
export function beginHeroTween(
  key: string,
  target: TransitionRect,
  durationMs: number,
  onArrive: () => void,
  mode: "in" | "out" = "in",
): void {
  heroTween = { key, target, durationMs, mode, done: false, onArrive };
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

/** Nudge the canvas so the returning plane lands in the middle of the screen. */
export function setCameraGoal(x: number, y: number, durationMs: number): void {
  cameraGoal = { x, y, start: performance.now(), durationMs, from: null };
}

export function getCameraGoal(): CameraGoal | null {
  return cameraGoal;
}

export function isCanvasFrozen(): boolean {
  return active;
}

export function isTransitionActive(): boolean {
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
  cameraGoal = null;
  swapWaiter = null;
  heroScreenRect = null;
  active = false;
}
