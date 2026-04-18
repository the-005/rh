import * as THREE from "three";
import { hashString, seededRandom } from "~/src/utils";
import { CHUNK_SIZE, DEPTH_FADE_END } from "./constants";
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

const MIN_SEPARATION = 40;
const EDGE_PADDING = 15;
const POISSON_K = 30;
const ITEMS_PER_CHUNK = 2;

function samplePoissonDisk2D(
  count: number,
  areaSize: number,
  minDist: number,
  padding: number,
  rng: () => number,
): { x: number; y: number }[] {
  const lo = padding;
  const hi = areaSize - padding;
  const span = hi - lo;
  const points: { x: number; y: number }[] = [];

  for (let p = 0; p < count; p++) {
    if (p === 0) {
      points.push({ x: lo + rng() * span, y: lo + rng() * span });
      continue;
    }
    let best = { x: lo + rng() * span, y: lo + rng() * span };
    let bestMinD = Number.NEGATIVE_INFINITY;
    for (let k = 0; k < POISSON_K; k++) {
      const cx = lo + rng() * span;
      const cy = lo + rng() * span;
      let minD = Number.POSITIVE_INFINITY;
      for (const pt of points) {
        const d = Math.hypot(cx - pt.x, cy - pt.y);
        if (d < minD) minD = d;
      }
      if (minD >= minDist) {
        best = { x: cx, y: cy };
        break;
      }
      if (minD > bestMinD) {
        bestMinD = minD;
        best = { x: cx, y: cy };
      }
    }
    points.push(best);
  }
  return points;
}

export function getChunkCyclePositions(
  cx: number,
  cy: number,
  cz: number,
  cycleNumber: number,
): { x: number; y: number }[] {
  const seed = hashString(`${SESSION_SEED},${cx},${cy},${cz},cycle${cycleNumber}`);
  let counter = 0;
  const rng = () => seededRandom(seed + counter++);
  const offsets = samplePoissonDisk2D(ITEMS_PER_CHUNK, CHUNK_SIZE, MIN_SEPARATION, EDGE_PADDING, rng);
  return offsets.map((o) => ({ x: cx * CHUNK_SIZE + o.x, y: cy * CHUNK_SIZE + o.y }));
}

export const generateChunkPlanes = (cx: number, cy: number, cz: number): PlaneData[] => {
  const planes: PlaneData[] = [];
  const seed = hashString(`${SESSION_SEED},${cx},${cy},${cz}`);
  // Golden ratio sequence on chunk coordinates: maximises the minimum gap
  // between any two chunk phases across the entire visible grid, eliminating
  // cross-chunk depth collisions that random phases can't prevent.
  const GOLDEN_RATIO = 0.6180339887498949;
  const chunkSeq = (cx + 10) * 400 + (cy + 10) * 20 + (cz + 10);
  const chunkPhase = (((chunkSeq + SESSION_SEED) * GOLDEN_RATIO) % 1) * DEPTH_FADE_END;
  const slotStep = DEPTH_FADE_END / ITEMS_PER_CHUNK;

  const positions = getChunkCyclePositions(cx, cy, cz, 0);

  for (let i = 0; i < ITEMS_PER_CHUNK; i++) {
    const s = seed + i * 1000;
    const r = (n: number) => seededRandom(s + n);
    const size = 20 + r(4) * 10;

    planes.push({
      id: `${cx}-${cy}-${cz}-${i}`,
      position: new THREE.Vector3(
        positions[i].x,
        positions[i].y,
        cz * CHUNK_SIZE + r(2) * CHUNK_SIZE,
      ),
      scale: new THREE.Vector3(size, size, 1),
      mediaIndex: Math.floor(r(5) * 1_000_000),
      depthPhase: (chunkPhase + i * slotStep) % DEPTH_FADE_END,
      chunkIndex: i,
    });
  }

  return planes;
};

export const generateChunkPlanesCached = (cx: number, cy: number, cz: number): PlaneData[] => {
  const key = `${cx},${cy},${cz}`;
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
