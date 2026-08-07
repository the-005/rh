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
// apart; jitter radius 25 keeps every pair ≥63 apart, above the ~53-unit span
// of the widest image (aspect 1.78 at max size 30).
const LATTICE_SITES: Record<number, [number, number][]> = {
  1: [[0.5, 0.5]],
  2: [[0.25, 0.25], [0.75, 0.75]],
  3: [[0.25, 0.25], [0.75, 0.55], [0.35, 0.85]],
  4: [[0.25, 0.25], [0.75, 0.25], [0.25, 0.75], [0.75, 0.75]],
};
const JITTER_RADIUS: Record<number, number> = { 1: 45, 2: 25, 3: 10, 4: 12 };

export function getChunkCyclePositions(
  cx: number,
  cy: number,
  cz: number,
  cycleNumber: number,
): { x: number; y: number }[] {
  const n = Math.min(Math.max(Math.round(tuning.itemsPerChunk), 1), 4);
  const sites = LATTICE_SITES[n];
  const jitter = JITTER_RADIUS[n];
  // Odd z-layers use the anti-diagonal so the layers interleave in XY instead
  // of stacking on the same sites — doubles effective coverage for n=2.
  const flipX = n === 2 && ((cz % 2) + 2) % 2 === 1;

  return sites.map(([sx, sy], i) => {
    const seed = hashString(`${SESSION_SEED},${cx},${cy},${cz},${i},cycle${cycleNumber}`);
    const r = jitter * Math.sqrt(seededRandom(seed));
    const theta = 2 * Math.PI * seededRandom(seed + 1);
    const fx = flipX ? 1 - sx : sx;
    return {
      x: cx * CHUNK_SIZE + fx * CHUNK_SIZE + r * Math.cos(theta),
      y: cy * CHUNK_SIZE + sy * CHUNK_SIZE + r * Math.sin(theta),
    };
  });
}

// Golden ratio QMC constants — gives maximally-separated phases for any 3D grid of chunks.
const PHI1 = 0.6180339887498949;
const PHI2 = 0.7548776662466927;
const PHI3 = 0.5698402909980532;

export const generateChunkPlanes = (cx: number, cy: number, cz: number): PlaneData[] => {
  const planes: PlaneData[] = [];
  const seed = hashString(`${SESSION_SEED},${cx},${cy},${cz}`);
  // QMC sequence: each (cx,cy,cz) maps to a unique, evenly-distributed phase in [0, depthFadeEnd).
  // Session offset scrambles the pattern each page load so it doesn't look static.
  const sessionFrac = seededRandom(SESSION_SEED);
  const chunkPhase = (((cx * PHI1 + cy * PHI2 + cz * PHI3 + sessionFrac) % 1) + 1) % 1 * tuning.depthFadeEnd;
  const { itemsPerChunk, minSize, maxSize } = tuning;
  const slotStep = tuning.zSpread / Math.max(itemsPerChunk, 1);

  const positions = getChunkCyclePositions(cx, cy, cz, 0);

  for (let i = 0; i < itemsPerChunk; i++) {
    const s = seed + i * 1000;
    const r = (n: number) => seededRandom(s + n);
    const size = minSize + r(4) * (maxSize - minSize);

    planes.push({
      id: `${cx}-${cy}-${cz}-${i}`,
      position: new THREE.Vector3(
        positions[i].x,
        positions[i].y,
        cz * CHUNK_SIZE + r(2) * CHUNK_SIZE,
      ),
      scale: new THREE.Vector3(size, size, 1),
      mediaIndex: Math.floor(r(5) * 1_000_000),
      depthPhase: (chunkPhase + i * slotStep) % tuning.depthFadeEnd,
      chunkIndex: i,
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
