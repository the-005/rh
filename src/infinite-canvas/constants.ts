import { run } from "~/src/utils";

export const CHUNK_SIZE = 160;
export const RENDER_DISTANCE = 2;
export const CHUNK_FADE_MARGIN = 1;
export const MAX_VELOCITY = 3.2;
export const NEAR_FADE_END = 70;
export const DEPTH_FADE_START = 340;
export const DEPTH_FADE_END = 520;
export const INVIS_THRESHOLD = 0.01;
export const KEYBOARD_SPEED = 0.18;
export const VELOCITY_LERP = 0.08;
export const VELOCITY_DECAY = 0.96;
export const INITIAL_CAMERA_Z = 50;
/** How far the camera leans toward the cursor (mouse parallax), in world units at a screen edge. */
export const PARALLAX_AMOUNT = 8;

// Touch (the owner, 7 Nov, starting the phone version): one finger swiping up
// or down moves through depth, as a scroll wheel does; sideways it pans. Which
// it is gets decided once the finger has moved TOUCH_AXIS_LOCK_PX. Two fingers
// pan in any direction, and pinching moves through depth too.
//
// It steers directly, as an iPhone list does (the owner, the same day: "it
// reacts too slow"): while fingers are down the gallery moves exactly what they
// moved, with none of the wheel's smoothing; when they lift it glides on at
// their speed and slows down, settling a little sooner than an iPhone list
// does. Fingers that stop before lifting stop
// it, and a touch catches it mid-glide.
/** Depth units per pixel a finger swipes up or down. */
export const TOUCH_DEPTH_PER_PX = 0.5;
/** Gallery units per pixel a finger pans (about one to one for images at middle depth). */
export const TOUCH_PAN_PER_PX = 0.4;
/** Depth units per pixel two fingers pinch. */
export const TOUCH_PINCH_PER_PX = 0.5;
/** How far a finger moves before its swipe counts as depth or pan. */
export const TOUCH_AXIS_LOCK_PX = 8;
/** The glide's speed after each millisecond: a little quicker to settle than
 *  UIScrollView's normal 0.998, which left a fast flick drifting for 2.4 s. */
export const TOUCH_GLIDE_PER_MS = 0.997;
/** The fastest glide, in units per millisecond, so a fling doesn't race through every image. */
export const TOUCH_GLIDE_MAX = 0.8;
/** Below this speed (units per millisecond) the glide ends. */
export const TOUCH_GLIDE_END = 0.01;
/** The glide's speed is the fingers' over their last this many milliseconds… */
export const TOUCH_FLING_WINDOW_MS = 80;
/** …unless they had been still for this long before lifting: then there's no glide. */
export const TOUCH_FLING_STALE_MS = 50;

export type ChunkOffset = {
  dx: number;
  dy: number;
  dz: number;
  dist: number;
};

export const CHUNK_OFFSETS: ChunkOffset[] = run(() => {
  const maxDist = RENDER_DISTANCE + CHUNK_FADE_MARGIN;
  const offsets: ChunkOffset[] = [];
  for (let dx = -maxDist; dx <= maxDist; dx++) {
    for (let dy = -maxDist; dy <= maxDist; dy++) {
      for (let dz = -1; dz <= 1; dz++) {
        const dist = Math.max(Math.abs(dx), Math.abs(dy), Math.abs(dz));
        if (dist > maxDist) continue;
        offsets.push({ dx, dy, dz, dist });
      }
    }
  }
  return offsets;
});
