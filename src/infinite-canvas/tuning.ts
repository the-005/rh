import { DEPTH_FADE_END, DEPTH_FADE_START } from "./constants";

export type TuningValues = {
  itemsPerChunk: number;
  minSize: number;
  maxSize: number;
  depthFadeStart: number;
  depthFadeEnd: number;
  zSpread: number;
};

export const tuning: TuningValues = {
  itemsPerChunk: 2,
  minSize: 20,
  maxSize: 30,
  depthFadeStart: DEPTH_FADE_START,
  depthFadeEnd: DEPTH_FADE_END,
  zSpread: DEPTH_FADE_END / 2,
};
