import * as THREE from "three";
import { hashString, seededRandom } from "~/src/utils";
import { CHUNK_SIZE } from "./constants";
import { tuning } from "./tuning";
import type { PlaneData } from "./types";

export const SESSION_SEED = Math.floor(Math.random() * 1_000_000);

const MAX_PLANE_CACHE = 256;
const planeCache = new Map<string, PlaneData[]>();

const touchPlaneCache = (key: string) => {
  const v = planeCache.get(key);
  if (!v) {
    return;
  }

  planeCache.delete(key);
  planeCache.set(key, v);
};

export const clearPlaneCache = () => planeCache.clear();

const evictPlaneCache = () => {
  while (planeCache.size > MAX_PLANE_CACHE) {
    const firstKey = planeCache.keys().next().value as string | undefined;
    if (!firstKey) break;
    planeCache.delete(firstKey);
  }
};

export const getChunkUpdateThrottleMs = (isZooming: boolean, zoomSpeed: number): number => {
  if (zoomSpeed > 1.0) {
    return 500;
  }

  if (isZooming) {
    return 400;
  }

  return 100;
};

export const getMediaDimensions = (media: HTMLImageElement | undefined) => {
  const width = media instanceof HTMLImageElement ? media.naturalWidth || media.width : undefined;
  const height = media instanceof HTMLImageElement ? media.naturalHeight || media.height : undefined;
  return { width, height };
};

// Staggered lattice sites (as fractions of chunk size). The union across all
// chunks tiles into a uniform grid, capping the worst-case empty XY region at
// ~half a chunk — random per-chunk scatter allowed voids of 1.5+ chunks.
// For itemsPerChunk=2, nearest sites (same or adjacent chunk) are 113 units
// apart; jitter radius 15 keeps every pair ≥83 apart — comfortably above the
// ~53-unit span of the widest image (aspect 1.78 at max size 30) — and keeps
// interleaved z-layer sites (80 apart) ≥50 apart in XY.
const LATTICE_SITES: Record<number, [number, number][]> = {
  1: [[0.5, 0.5]],
  2: [[0.25, 0.25], [0.75, 0.75]],
  3: [[0.25, 0.25], [0.75, 0.55], [0.35, 0.85]],
  4: [[0.25, 0.25], [0.75, 0.25], [0.25, 0.75], [0.75, 0.75]],
};
// For n=2, each of the three z-layers gets its own site variant so no two
// layers ever share XY sites (pre-jitter cross-layer distance ≥56.6 units):
// layer 0 = diagonal, layer 1 = anti-diagonal, layer 2 = center/corner.
const LATTICE_VARIANTS_N2: [number, number][][] = [
  [[0.25, 0.25], [0.75, 0.75]],
  [[0.75, 0.25], [0.25, 0.75]],
  [[0.5, 0.5], [0.0, 0.0]],
];
const JITTER_RADIUS: Record<number, number> = { 1: 40, 2: 15, 3: 10, 4: 12 };

export const zLayerOf = (cz: number) => ((cz % 3) + 3) % 3;

export function getChunkCyclePositions(
  cx: number,
  cy: number,
  cz: number,
  cycleNumber: number,
): { x: number; y: number }[] {
  const n = Math.min(Math.max(Math.round(tuning.itemsPerChunk), 1), 4);
  const sites = n === 2 ? LATTICE_VARIANTS_N2[zLayerOf(cz)] : LATTICE_SITES[n];
  const jitter = JITTER_RADIUS[n];

  return sites.map(([sx, sy], i) => {
    const seed = hashString(`${SESSION_SEED},${cx},${cy},${cz},${i},cycle${cycleNumber}`);
    const r = jitter * Math.sqrt(seededRandom(seed));
    const theta = 2 * Math.PI * seededRandom(seed + 1);
    return {
      x: cx * CHUNK_SIZE + sx * CHUNK_SIZE + r * Math.cos(theta),
      y: cy * CHUNK_SIZE + sy * CHUNK_SIZE + r * Math.sin(theta),
    };
  });
}

// Depth-phase constants found by grid search: maximize the minimum circular
// phase gap over all SAME-DIRECTION plane pairs (parity of Δcx+Δcy+Δslot even —
// only those keep a fixed relative depth; opposite-direction pairs drift apart
// on the next scroll) within ±2 chunk columns, with a ±4 guard against exact
// rational welds (the previous 0.4242/0.6363 pair was in exact 2:3 ratio,
// locking every (3,−2)-offset column pair to identical depths forever).
// Result: every persistent pair within ±2 columns stays ≥31.8 units apart.
const ALPHA_X = 0.38788;
const ALPHA_Y = 0.46464;

export const generateChunkPlanes = (cx: number, cy: number, cz: number): PlaneData[] => {
  const planes: PlaneData[] = [];
  const seed = hashString(`${SESSION_SEED},${cx},${cy},${cz}`);
  // Session offset scrambles the pattern each page load so it doesn't look static.
  const sessionFrac = seededRandom(SESSION_SEED);
  const { itemsPerChunk, minSize, maxSize, depthFadeEnd, zSpread } = tuning;
  const columnPhase = ((((cx * ALPHA_X + cy * ALPHA_Y + sessionFrac) % 1) + 1) % 1) * depthFadeEnd;
  const zLayer = zLayerOf(cz);
  const numSlots = 3 * Math.max(itemsPerChunk, 1);

  const positions = getChunkCyclePositions(cx, cy, cz, 0);

  for (let i = 0; i < itemsPerChunk; i++) {
    const s = seed + i * 1000;
    const r = (n: number) => seededRandom(s + n);
    const size = minSize + r(4) * (maxSize - minSize);
    const slot = zLayer * itemsPerChunk + i;
    const slotOffset = (slot / numSlots) * zSpread;

    planes.push({
      id: `${cx}-${cy}-${cz}-${i}`,
      position: new THREE.Vector3(
        positions[i].x,
        positions[i].y,
        cz * CHUNK_SIZE + r(2) * CHUNK_SIZE,
      ),
      scale: new THREE.Vector3(size, size, 1),
      mediaIndex: Math.floor(r(5) * 1_000_000),
      depthPhase: (columnPhase + slotOffset) % depthFadeEnd,
      chunkIndex: i,
      zDir: ((((cx + cy + slot) % 2) + 2) % 2 === 0 ? 1 : -1) as 1 | -1,
    });
  }

  return planes;
};

export const generateChunkPlanesCached = (cx: number, cy: number, cz: number): PlaneData[] => {
  const { itemsPerChunk, minSize, maxSize, depthFadeEnd } = tuning;
  const key = `${cx},${cy},${cz},${itemsPerChunk},${minSize},${maxSize},${depthFadeEnd},${tuning.zSpread}`;
  const cached = planeCache.get(key);
  if (cached) {
    touchPlaneCache(key);
    return cached;
  }

  const planes = generateChunkPlanes(cx, cy, cz);
  planeCache.set(key, planes);
  evictPlaneCache();
  return planes;
};

export const shouldThrottleUpdate = (lastUpdateTime: number, throttleMs: number, currentTime: number): boolean => {
  return currentTime - lastUpdateTime >= throttleMs;
};
