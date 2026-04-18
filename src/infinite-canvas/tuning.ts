import { DEPTH_FADE_END, DEPTH_FADE_START } from "./constants";

export type TuningValues = {
  itemsPerChunk: number;
  minSize: number;
  maxSize: number;
  depthFadeStart: number;
  depthFadeEnd: number;
};

export const tuning: TuningValues = {
  itemsPerChunk: 2,
  minSize: 20,
  maxSize: 30,
  depthFadeStart: DEPTH_FADE_START,
  depthFadeEnd: DEPTH_FADE_END,
};
