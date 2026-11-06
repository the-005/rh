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
/** Depth per pixel a finger swipes up or down (the wheel's is 0.012 per unit of deltaY). */
export const TOUCH_SWIPE_DEPTH = 0.016;
/** Pan per pixel a finger moves. */
export const TOUCH_PAN_SPEED = 0.02;
/** Depth per pixel two fingers pinch. */
export const TOUCH_PINCH_DEPTH = 0.006;
/** How far a finger moves before its swipe counts as depth or pan. */
export const TOUCH_AXIS_LOCK_PX = 8;

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
