/**
 * pieces.ts — how a video's preview pieces are suggested, and how its cuts are
 * found: one set of rules for the preview cutter in the browser
 * (admin/src/cutter-core.ts) and the automatic previews made in the cloud
 * (scripts/process-media.ts), so an automatic preview is exactly what the
 * cutter would have suggested.
 *
 * The rules, from the Preview Cutter artifact (the owner, 1–2 Nov): two pieces
 * (the join between them and the restart give the loop its two cuts), placed a
 * quarter and three fifths of the way through; with cuts, each starts on the
 * first frame of a shot and stays inside it, up to 4 s each and 10 s in all;
 * with none, two 4 s pieces (shorter in a short video) at those same places.
 */

import { PIECE_MIN, PREVIEW_MAX, type Piece } from "./shared.ts";

const SUGGEST_AT = [0.25, 0.6]; // where the suggested pieces sit, as a share of the video
const SUGGEST_LEN = 4; // longest suggested piece, s

// A cut: a frame difference above CUT_MIN and CUT_RATIO times the median of
// the last few frames (so one cut doesn't hide another a few frames later).
const CUT_MIN = 0.1;
const CUT_RATIO = 3;
const RECENT = 8;

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** The shots long enough to hold a piece: each from a cut (or the start) to the next (or the end). */
export function shots(cuts: number[], duration: number): Piece[] {
  const b = [0, ...cuts, duration];
  const out: Piece[] = [];
  for (let i = 0; i < b.length - 1; i++) if (b[i + 1] - b[i] >= PIECE_MIN) out.push({ s: b[i], e: b[i + 1] });
  return out;
}

/** The two pieces a video opens with in the cutter, and its automatic preview. */
export function suggestPieces(cuts: number[], duration: number): Piece[] {
  if (!cuts.length) {
    const len = Math.min(SUGGEST_LEN, duration / 4);
    if (len < PIECE_MIN) return [{ s: 0, e: Math.min(duration, PREVIEW_MAX) }];
    return SUGGEST_AT.map((f) => {
      const s = clamp(f * duration, 0, duration - len);
      return { s, e: s + len };
    });
  }
  let pool = shots(cuts, duration).filter((sh) => sh.e - sh.s >= 1);
  if (pool.length < SUGGEST_AT.length) pool = shots(cuts, duration);
  const picks: Piece[] = [];
  for (const f of SUGGEST_AT) {
    const target = f * duration;
    const pick = pool.filter((sh) => !picks.includes(sh)).sort((a, b) => Math.abs(a.s - target) - Math.abs(b.s - target))[0];
    if (pick) picks.push(pick);
  }
  picks.sort((a, b) => a.s - b.s);
  let room = PREVIEW_MAX;
  return picks
    .map((sh) => {
      const len = Math.min(SUGGEST_LEN, sh.e - sh.s, room);
      room -= len;
      return { s: sh.s, e: sh.s + len };
    })
    .filter((p) => p.e - p.s >= PIECE_MIN);
}

/**
 * Finds cuts frame by frame from small greyscale frames (the cutter uses
 * 64×36). Feed it each frame's luma (0–255) and time; it returns the time when
 * that frame starts a new shot.
 */
export function cutDetector(fps: number) {
  let prev: ArrayLike<number> | null = null;
  const recent: number[] = [];
  let last = -1;
  return (luma: ArrayLike<number>, t: number): number | null => {
    let cut: number | null = null;
    if (prev) {
      let sum = 0;
      for (let i = 0; i < luma.length; i++) sum += Math.abs(luma[i] - prev[i]);
      const diff = sum / (luma.length * 255);
      const base = recent.length ? [...recent].sort((a, b) => a - b)[recent.length >> 1] : 0;
      if (diff > CUT_MIN && diff > base * CUT_RATIO + 0.02 && t - last > 0.5 / fps) {
        cut = t;
        last = t;
      }
      recent.push(diff);
      if (recent.length > RECENT) recent.shift();
    }
    prev = luma;
    return cut;
  };
}
