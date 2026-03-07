import type * as React from "react";
import type * as THREE from "three";

export type MediaItem = {
  url: string;
  width: number;
  height: number;
};

export type SharedScrollState = { accumulated: number };
export type SharedPanState = { x: number; y: number; driftX: number; driftY: number };
export type SharedDragState = { isDragging: boolean };
export type SplitCanvasRole = "primary" | "secondary";
export type SplitCanvasSharedRefs = {
  scrollRef: React.MutableRefObject<SharedScrollState>;
  panRef: React.MutableRefObject<SharedPanState>;
  dragRef: React.MutableRefObject<SharedDragState>;
};

export type InfiniteCanvasProps = {
  media: MediaItem[];
  onTextureProgress?: (progress: number) => void;
  showFps?: boolean;
  showControls?: boolean;
  cameraFov?: number;
  cameraNear?: number;
  cameraFar?: number;
  fogNear?: number;
  fogFar?: number;
  backgroundColor?: string;
  fogColor?: string;
  splitRole?: SplitCanvasRole;
  splitRefs?: SplitCanvasSharedRefs;
  zoomSign?: 1 | -1;
  side?: "left" | "right";
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
};
