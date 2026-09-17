import type * as THREE from "three";

export type MediaItem = {
  /** Full-size copy (3000px long side): the project page and the index. */
  url: string;
  /** Small copy (1000px long side) for the canvas, which holds every texture at once. */
  canvasUrl: string;
  width: number;
  height: number;
  project?: string;
};

export type InfiniteCanvasProps = {
  media: MediaItem[];
  onMediaClick?: (item: MediaItem, rect: { x: number; y: number; width: number; height: number }) => void;
  showFps?: boolean;
  showControls?: boolean;
  showDebug?: boolean;
  showTuning?: boolean;
  cameraFov?: number;
  cameraNear?: number;
  cameraFar?: number;
  fogNear?: number;
  fogFar?: number;
  backgroundColor?: string;
  fogColor?: string;
  splashSrc?: string;
  splashAspect?: number;
  onSplashReady?: () => void;
  /** The splash plane has left sight for good (scrolled away or behind the camera). */
  onSplashGone?: () => void;
};

export type ChunkData = {
  key: string;
  cx: number;
  cy: number;
  cz: number;
};

export type PlaneData = {
  id: string;
  position: THREE.Vector3;
  scale: THREE.Vector3;
  mediaIndex: number;
  depthPhase: number;
  chunkIndex: number;
};
