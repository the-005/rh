/**
 * view-shrink.ts — the gallery's images shrinking away as the index opens, and
 * growing back when it closes (the owner, 2 Nov, after palmer-dinnerware.com;
 * tried first in the "Gallery Index Shrink" artifact).
 *
 * Each image shrinks to a point around its own centre. How long it takes
 * follows its depth: the nearest (biggest) take SHRINK_NEAR_MS, the farthest
 * SHRINK_FAR_MS, and their starts are spread over SHRINK_SPREAD_MS, so the
 * small far ones are gone first. Growing back runs the same timings, easing
 * out instead of in. Every MediaPlane reads `galleryScale` each frame; the app
 * drives the phases (src/app).
 */

export const SHRINK_NEAR_MS = 1000;
export const SHRINK_FAR_MS = 530;
export const SHRINK_SPREAD_MS = 250;
/** White between the gallery's images going and the index's rows arriving. */
export const BEAT_MS = 260;
/** The index fading to white before the gallery grows back (matches --index-out in the index stylesheet). */
export const INDEX_OUT_MS = 450;

/** Depth from the camera, in scene units, that counts as nearest and farthest. */
const NEAR_DEPTH = 60;
const FAR_DEPTH = 900;

type Phase = "shown" | "shrinking" | "hidden" | "growing";
let phase: Phase = "shown";
let startedAt = 0;

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
// Shrinking gathers speed as it goes; growing slows as it settles.
const easeIn = (t: number) => t ** 2.4;
const easeOut = (t: number) => 1 - (1 - t) ** 3;

/** Each plane's start within the spread, fixed by its key so it doesn't change frame to frame. */
const offsets = new Map<string, number>();
function offsetFor(key: string) {
  let offset = offsets.get(key);
  if (offset === undefined) {
    let h = 2166136261;
    for (let i = 0; i < key.length; i++) h = Math.imul(h ^ key.charCodeAt(i), 16777619);
    offset = ((h >>> 0) % 1000) / 1000 * SHRINK_SPREAD_MS;
    offsets.set(key, offset);
  }
  return offset;
}

function run(next: "shrinking" | "growing", settled: Phase) {
  phase = next;
  startedAt = performance.now();
  return new Promise<void>((resolve) =>
    setTimeout(() => {
      if (phase === next) phase = settled;
      resolve();
    }, SHRINK_NEAR_MS + SHRINK_SPREAD_MS)
  );
}

/** The gallery's images shrink away; resolves once the last is gone. */
export const shrinkGallery = () => (phase === "hidden" ? Promise.resolve() : run("shrinking", "hidden"));
/** The gallery's images grow back where they were; nothing to do if they're already there. */
export const growGallery = () => (phase === "shown" ? Promise.resolve() : run("growing", "shown"));
/** Away at once, as on a direct link to the index, so leaving it can still grow them back. */
export const hideGallery = () => {
  phase = "hidden";
};
/** Whether the gallery's images are fully there: hovering and clicking only count then. */
export const galleryShown = () => phase === "shown";

/** How big a plane is drawn this frame, as a share of its size: 1 at rest, 0 while away. */
export function galleryScale(key: string, depth: number): number {
  if (phase === "shown") return 1;
  if (phase === "hidden") return 0;
  const near = clamp01(1 - (depth - NEAR_DEPTH) / (FAR_DEPTH - NEAR_DEPTH));
  const duration = SHRINK_FAR_MS + (SHRINK_NEAR_MS - SHRINK_FAR_MS) * near;
  const t = clamp01((performance.now() - startedAt - offsetFor(key)) / duration);
  return phase === "shrinking" ? 1 - easeIn(t) : easeOut(t);
}
