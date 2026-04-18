import type * as THREE from "three";

export type MediaItem = {
  url: string;
  width: number;
  height: number;
  category?: string;
  project?: string;
};

export type InfiniteCanvasProps = {
  media: MediaItem[];
  onTextureProgress?: (progress: number) => void;
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
  activeCategory?: string;
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
