import { DEPTH_FADE_START, NEAR_FADE_END } from "./constants";

export type TuningValues = {
  itemsPerChunk: number;
  minSize: number;
  maxSize: number;
  depthFadeNear: number;
  depthFadeStart: number;
  depthFadeEnd: number;
  zSpread: number;
};

export const tuning: TuningValues = {
  itemsPerChunk: 2,
  minSize: 20,
  maxSize: 30,
  depthFadeNear: NEAR_FADE_END,
  depthFadeStart: DEPTH_FADE_START,
  depthFadeEnd: 1000,
  zSpread: 1000,
};
