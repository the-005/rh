import { KeyboardControls, Stats, useKeyboardControls, useProgress } from "@react-three/drei";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import * as React from "react";
import * as THREE from "three";
import { useIsTouchDevice } from "~/src/use-is-touch-device";
import { clamp, lerp } from "~/src/utils";
import {
  CHUNK_FADE_MARGIN,
  CHUNK_OFFSETS,
  CHUNK_SIZE,
  INITIAL_CAMERA_Z,
  INVIS_THRESHOLD,
  KEYBOARD_SPEED,
  MAX_VELOCITY,
  RENDER_DISTANCE,
  VELOCITY_DECAY,
  VELOCITY_LERP,
} from "./constants";
import styles from "./style.module.css";
import { getTexture } from "./texture-manager";
import type { ChunkData, InfiniteCanvasProps, MediaItem, PlaneData } from "./types";
import { tuning } from "./tuning";
import { clearPlaneCache, generateChunkPlanesCached, getChunkCyclePositions, getChunkUpdateThrottleMs, shouldThrottleUpdate } from "./utils";

const PLANE_GEOMETRY = new THREE.PlaneGeometry(1, 1);

function getMeshScreenRect(mesh: THREE.Mesh, camera: THREE.Camera) {
  const pos = new THREE.Vector3();
  mesh.getWorldPosition(pos);
  const ws = new THREE.Vector3();
  mesh.getWorldScale(ws);
  const hw = ws.x / 2;
  const hh = ws.y / 2;
  const w = window.innerWidth;
  const h = window.innerHeight;
  const toScreen = (x: number, y: number, z: number) => {
    const v = new THREE.Vector3(x, y, z).project(camera);
    return { x: (v.x + 1) / 2 * w, y: (1 - v.y) / 2 * h };
  };
  const tl = toScreen(pos.x - hw, pos.y + hh, pos.z);
  const br = toScreen(pos.x + hw, pos.y - hh, pos.z);
  return { x: tl.x, y: tl.y, width: br.x - tl.x, height: br.y - tl.y };
}

const KEYBOARD_MAP = [
  { name: "forward", keys: ["w", "W", "ArrowUp"] },
  { name: "backward", keys: ["s", "S", "ArrowDown"] },
  { name: "left", keys: ["a", "A", "ArrowLeft"] },
  { name: "right", keys: ["d", "D", "ArrowRight"] },
  { name: "up", keys: ["e", "E"] },
  { name: "down", keys: ["q", "Q"] },
];

type KeyboardKeys = {
  forward: boolean;
  backward: boolean;
  left: boolean;
  right: boolean;
  up: boolean;
  down: boolean;
};

const getTouchDistance = (touches: Touch[]) => {
  if (touches.length < 2) return 0;
  const [t1, t2] = touches;
  const dx = t1.clientX - t2.clientX;
  const dy = t1.clientY - t2.clientY;
  return Math.sqrt(dx * dx + dy * dy);
};

type CameraGridState = {
  cx: number;
  cy: number;
  cz: number;
  camZ: number;
  camX: number;
  /** Per-frame Z velocity applied to image depth offsets (not camera). */
  scrollDelta: number;
  /** Running sum of all scrollDelta values since session start. Used to sync
   *  absoluteZOffset when a MediaPlane remounts after its chunk leaves/re-enters view. */
  cumulativeScroll: number;
  activeCategory: string;
};

function MediaPlane({
  position,
  scale,
  mediaPool,
  mediaIndex,
  depthPhase,
  chunkIndex,
  chunkCx,
  chunkCy,
  chunkCz,
  cameraGridRef,
  onMediaClick,
  showLabel,
}: {
  position: THREE.Vector3;
  scale: THREE.Vector3;
  mediaPool: MediaItem[];
  mediaIndex: number;
  depthPhase: number;
  chunkIndex: number;
  chunkCx: number;
  chunkCy: number;
  chunkCz: number;
  cameraGridRef: React.RefObject<CameraGridState>;
  onMediaClick?: (item: MediaItem, rect: { x: number; y: number; width: number; height: number }) => void;
  showLabel?: boolean;
}) {
  const groupRef = React.useRef<THREE.Group>(null);
  const meshRef = React.useRef<THREE.Mesh>(null);
  const materialRef = React.useRef<THREE.MeshBasicMaterial>(null);
  const labelRef = React.useRef<THREE.Sprite>(null);

  const labelTexture = React.useMemo(() => {
    if (!showLabel) return null;
    const canvas = document.createElement("canvas");
    canvas.width = 192;
    canvas.height = 48;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    ctx.fillStyle = "rgba(220,60,0,0.85)";
    ctx.roundRect(2, 2, 188, 44, 6);
    ctx.fill();
    ctx.fillStyle = "#ffffff";
    ctx.font = "bold 22px monospace";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(`${chunkCx},${chunkCy},${chunkCz} #${chunkIndex}`, 96, 24);
    return new THREE.CanvasTexture(canvas);
  }, [showLabel, chunkCx, chunkCy, chunkIndex]);

  React.useEffect(() => () => { labelTexture?.dispose(); }, [labelTexture]);
  const initPos = getChunkCyclePositions(chunkCx, chunkCy, chunkCz, 0)[chunkIndex];
  const isInitRight = initPos.x >= cameraGridRef.current.camX;
  const initialAbsoluteZ = depthPhase + cameraGridRef.current.cumulativeScroll * (isInitRight ? 1 : -1);
  const initialCycle = Math.floor(initialAbsoluteZ / tuning.depthFadeEnd);

  const localState = React.useRef({
    opacity: 0,
    ready: false,
    absoluteZOffset: initialAbsoluteZ,
    lastCycle: initialCycle,
    swapPending: false,
    filterFade: false,
    cycleX: initPos.x,
    cycleY: initPos.y,
  });

  const [cycleIndex, setCycleIndex] = React.useState(initialCycle);
  const media = mediaPool[((mediaIndex + cycleIndex) % mediaPool.length + mediaPool.length) % mediaPool.length];

  const [texture, setTexture] = React.useState<THREE.Texture | null>(null);
  const [isReady, setIsReady] = React.useState(false);

  useFrame((_state, delta) => {
    const material = materialRef.current;
    const mesh = meshRef.current;
    const state = localState.current;

    if (!material || !mesh) return;

    // zOffset is the image's depth from the camera within [0, DEPTH_FADE_END).
    // All images wrap at the same modulo boundary so they never converge in depth.
    // Right images zoom in on scroll-up, left images zoom out.
    const { scrollDelta, camX } = cameraGridRef.current;
    if (Math.abs(scrollDelta) > 0.00001) {
      const isRight = state.cycleX >= camX;
      state.absoluteZOffset += scrollDelta * (isRight ? 1 : -1);
    }

    const { depthFadeEnd, depthFadeStart, depthFadeNear } = tuning;
    const zOffset = ((state.absoluteZOffset % depthFadeEnd) + depthFadeEnd) % depthFadeEnd;

    // Snap opacity to 0 and swap image whenever the plane crosses a depth cycle boundary.
    // Also relocate to a new random position within the chunk — deterministic per cycle
    // so scrolling back restores the exact same position (reversibility preserved).
    const newCycle = Math.floor(state.absoluteZOffset / depthFadeEnd);
    if (newCycle !== state.lastCycle) {
      state.lastCycle = newCycle;
      state.opacity = 0;
      state.swapPending = false;
      setCycleIndex(newCycle);
      const pos = getChunkCyclePositions(chunkCx, chunkCy, chunkCz, newCycle)[chunkIndex];
      state.cycleX = pos.x;
      state.cycleY = pos.y;
    }

    const effectiveZ = INITIAL_CAMERA_Z - zOffset;
    const group = groupRef.current;
    if (group) {
      group.position.x = state.cycleX;
      group.position.y = state.cycleY;
      group.position.z = effectiveZ;
    }

    const cam = cameraGridRef.current;
    const dist = Math.max(Math.abs(chunkCx - cam.cx), Math.abs(chunkCy - cam.cy), Math.abs(chunkCz - cam.cz));
    const absDepth = zOffset;

    if (zOffset > depthFadeEnd + 50) {
      state.opacity = 0;
      material.opacity = 0;
      material.depthWrite = false;
      mesh.visible = false;
      return;
    }

    const gridFade =
      dist <= RENDER_DISTANCE ? 1 : Math.max(0, 1 - (dist - RENDER_DISTANCE) / Math.max(CHUNK_FADE_MARGIN, 0.0001));

    const depthFade =
      absDepth <= depthFadeNear
        ? absDepth / depthFadeNear
        : absDepth <= depthFadeStart
          ? 1
          : Math.max(0, 1 - (absDepth - depthFadeStart) / Math.max(depthFadeEnd - depthFadeStart, 0.0001));

    const naturalTarget = Math.min(gridFade, depthFade * depthFade);

    // Category filter: planes whose current image doesn't match the active filter fade to 0.
    // Once invisible they advance to the next matching image in the pool and fade back in.
    const poolLen = mediaPool.length;
    const effectiveMedia = mediaPool[((mediaIndex + state.lastCycle) % poolLen + poolLen) % poolLen];
    const categoryMatch =
      cam.activeCategory === "all" || !effectiveMedia?.category || effectiveMedia.category === cam.activeCategory;

    if (!categoryMatch && !state.swapPending) state.swapPending = true;
    if (categoryMatch) state.swapPending = false;

    if (state.swapPending && state.opacity <= INVIS_THRESHOLD) {
      state.swapPending = false;
      for (let i = 1; i <= poolLen; i++) {
        const candidate = mediaPool[((mediaIndex + state.lastCycle + i) % poolLen + poolLen) % poolLen];
        if (cam.activeCategory === "all" || !candidate.category || candidate.category === cam.activeCategory) {
          state.lastCycle += i;
          state.opacity = 0;
          setCycleIndex(state.lastCycle);
          break;
        }
      }
    }

    const target = categoryMatch ? naturalTarget : 0;

    if (!categoryMatch) state.filterFade = true;
    if (state.filterFade && categoryMatch && state.opacity >= naturalTarget * 0.99) state.filterFade = false;

    const alpha = state.filterFade ? 1 - Math.pow(INVIS_THRESHOLD, delta / 1.6) : 0.1;
    state.opacity = target < INVIS_THRESHOLD && state.opacity < INVIS_THRESHOLD ? 0 : lerp(state.opacity, target, alpha);

    material.opacity = state.opacity;
    const isVisible = state.opacity > INVIS_THRESHOLD;
    mesh.visible = isVisible;
    if (labelRef.current) labelRef.current.visible = isVisible;
  });

  const displayScale = React.useMemo(() => {
    if (media.width && media.height) {
      const aspect = media.width / media.height;
      return new THREE.Vector3(scale.y * aspect, scale.y, 1);
    }
    return scale;
  }, [media.width, media.height, scale]);

  React.useEffect(() => {
    const state = localState.current;
    state.ready = false;
    state.opacity = 0;
    setIsReady(false);

    const material = materialRef.current;
    if (material) {
      material.opacity = 0;
      material.depthWrite = false;
      material.map = null;
    }

    const tex = getTexture(media, () => {
      state.ready = true;
      setIsReady(true);
    });
    setTexture(tex);
  }, [media]);

  React.useEffect(() => {
    const material = materialRef.current;
    const mesh = meshRef.current;
    const state = localState.current;

    if (!material || !mesh || !texture || !isReady || !state.ready) return;

    material.map = texture;
    material.opacity = state.opacity;
    mesh.scale.copy(displayScale);
  }, [displayScale, texture, isReady]);

  if (!texture || !isReady) return null;

  return (
    <group ref={groupRef} position={position}>
      {/* biome-ignore lint/a11y/noStaticElementInteractions: Three.js mesh is not a DOM element */}
      <mesh
        ref={meshRef}
        scale={displayScale}
        visible={false}
        geometry={PLANE_GEOMETRY}
        onClick={(e) => {
          const mesh = meshRef.current;
          const mat = materialRef.current;
          if (!mesh || !onMediaClick) return;

          // depthTest is off, so the visually topmost image may not be the closest in 3D.
          // Yield to any intersected mesh with meaningfully higher opacity (more visible).
          const myOpacity = mat?.opacity ?? 0;
          const shouldDefer = e.intersections.some((hit) => {
            if (hit.object === mesh) return false;
            const m = (hit.object as THREE.Mesh).material;
            const op = Array.isArray(m) ? 0 : ((m as THREE.MeshBasicMaterial).opacity ?? 0);
            return op > myOpacity + 0.05;
          });
          if (shouldDefer) return;

          e.stopPropagation();
          onMediaClick(media, getMeshScreenRect(mesh, e.camera));
        }}
      >
        <meshBasicMaterial ref={materialRef} transparent opacity={0} side={THREE.DoubleSide} depthTest={false} />
      </mesh>
      {showLabel && labelTexture && (
        <sprite ref={labelRef} visible={false} position={[0, displayScale.y / 2 + 3, 0]} scale={[12, 3, 1]}>
          <spriteMaterial map={labelTexture} transparent depthTest={false} />
        </sprite>
      )}
    </group>
  );
}

function SplashPlane({
  src,
  aspect,
  cameraGridRef,
}: {
  src: string;
  aspect: number;
  cameraGridRef: React.RefObject<CameraGridState>;
}) {
  const meshRef = React.useRef<THREE.Mesh>(null);
  const materialRef = React.useRef<THREE.MeshBasicMaterial>(null);
  const [texture, setTexture] = React.useState<THREE.Texture | null>(null);

  const SPLASH_HEIGHT = 40;
  const displayScale = new THREE.Vector3(SPLASH_HEIGHT * aspect, SPLASH_HEIGHT, 1);

  const localState = React.useRef({ opacity: 0, absoluteZOffset: 100 });

  React.useEffect(() => {
    const loader = new THREE.TextureLoader();
    loader.load(src, (tex) => {
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.needsUpdate = true;
      setTexture(tex);
    });
  }, [src]);

  React.useEffect(() => {
    const material = materialRef.current;
    if (!material || !texture) return;
    material.map = texture;
    material.needsUpdate = true;
  }, [texture]);

  useFrame(() => {
    const mesh = meshRef.current;
    const material = materialRef.current;
    if (!mesh || !material || !texture) return;

    const state = localState.current;
    const { scrollDelta } = cameraGridRef.current;
    state.absoluteZOffset += scrollDelta;

    const { depthFadeEnd, depthFadeStart, depthFadeNear } = tuning;
    const zOffset = ((state.absoluteZOffset % depthFadeEnd) + depthFadeEnd) % depthFadeEnd;
    mesh.position.z = INITIAL_CAMERA_Z - zOffset;

    const depthFade =
      zOffset <= depthFadeNear
        ? zOffset / depthFadeNear
        : zOffset <= depthFadeStart
          ? 1
          : Math.max(0, 1 - (zOffset - depthFadeStart) / Math.max(depthFadeEnd - depthFadeStart, 0.0001));

    const target = depthFade * depthFade;
    state.opacity =
      target < INVIS_THRESHOLD && state.opacity < INVIS_THRESHOLD
        ? 0
        : lerp(state.opacity, target, 0.1);

    material.opacity = state.opacity;
    mesh.visible = state.opacity > INVIS_THRESHOLD;
  });

  return (
    <mesh
      ref={meshRef}
      position={[0, 0, INITIAL_CAMERA_Z - 100]}
      scale={displayScale}
      visible={false}
      geometry={PLANE_GEOMETRY}
    >
      <meshBasicMaterial
        ref={materialRef}
        transparent
        opacity={0}
        side={THREE.DoubleSide}
        depthTest={false}
      />
    </mesh>
  );
}

function ChunkLabel({ cx, cy }: { cx: number; cy: number }) {
  const texture = React.useMemo(() => {
    const canvas = document.createElement("canvas");
    canvas.width = 256;
    canvas.height = 64;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    ctx.fillStyle = "rgba(0,100,255,0.75)";
    ctx.roundRect(4, 4, 248, 56, 8);
    ctx.fill();
    ctx.fillStyle = "#ffffff";
    ctx.font = "bold 28px monospace";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(`${cx},${cy}`, 128, 32);
    return new THREE.CanvasTexture(canvas);
  }, [cx, cy]);

  React.useEffect(() => () => { texture?.dispose(); }, [texture]);

  if (!texture) return null;

  const lx = cx * CHUNK_SIZE + CHUNK_SIZE / 2;
  const ly = cy * CHUNK_SIZE + CHUNK_SIZE / 2;
  const lz = INITIAL_CAMERA_Z - 150;

  return (
    <group>
      <sprite position={[lx, ly, lz]} scale={[24, 6, 1]}>
        <spriteMaterial map={texture} transparent depthTest={false} />
      </sprite>
      <mesh position={[lx, ly, lz]}>
        <planeGeometry args={[CHUNK_SIZE, CHUNK_SIZE]} />
        <meshBasicMaterial color="#0055ff" wireframe transparent opacity={0.15} depthTest={false} />
      </mesh>
    </group>
  );
}

function Chunk({
  cx,
  cy,
  cz,
  media,
  cameraGridRef,
  onMediaClick,
  showLabel,
}: {
  cx: number;
  cy: number;
  cz: number;
  media: MediaItem[];
  cameraGridRef: React.RefObject<CameraGridState>;
  onMediaClick?: (item: MediaItem, rect: { x: number; y: number; width: number; height: number }) => void;
  showLabel?: boolean;
}) {
  const [planes, setPlanes] = React.useState<PlaneData[] | null>(null);

  React.useEffect(() => {
    let canceled = false;
    const run = () => !canceled && setPlanes(generateChunkPlanesCached(cx, cy, cz));

    if (typeof requestIdleCallback !== "undefined") {
      const id = requestIdleCallback(run, { timeout: 100 });
      return () => {
        canceled = true;
        cancelIdleCallback(id);
      };
    }

    const id = setTimeout(run, 0);
    return () => {
      canceled = true;
      clearTimeout(id);
    };
  }, [cx, cy, cz]);

  if (!planes) return null;

  return (
    <group>
      {planes.map((plane) => (
        <MediaPlane
          key={plane.id}
          position={plane.position}
          scale={plane.scale}
          mediaPool={media}
          mediaIndex={plane.mediaIndex}
          depthPhase={plane.depthPhase}
          chunkIndex={plane.chunkIndex}
          chunkCx={cx}
          chunkCy={cy}
          chunkCz={cz}
          cameraGridRef={cameraGridRef}
          onMediaClick={onMediaClick}
          showLabel={showLabel}
        />
      ))}
      {showLabel && <ChunkLabel cx={cx} cy={cy} />}
    </group>
  );
}

type ControllerState = {
  velocity: { x: number; y: number; z: number };
  targetVel: { x: number; y: number; z: number };
  basePos: { x: number; y: number; z: number };
  drift: { x: number; y: number };
  mouse: { x: number; y: number };
  lastMouse: { x: number; y: number };
  scrollAccum: number;
  isDragging: boolean;
  lastTouches: Touch[];
  lastTouchDist: number;
  lastChunkKey: string;
  lastChunkUpdate: number;
  pendingChunk: { cx: number; cy: number; cz: number } | null;
};

const createInitialState = (camZ: number): ControllerState => ({
  velocity: { x: 0, y: 0, z: 0 },
  targetVel: { x: 0, y: 0, z: 0 },
  basePos: { x: 0, y: 0, z: camZ },
  drift: { x: 0, y: 0 },
  mouse: { x: 0, y: 0 },
  lastMouse: { x: 0, y: 0 },
  scrollAccum: 0,
  isDragging: false,
  lastTouches: [],
  lastTouchDist: 0,
  lastChunkKey: "",
  lastChunkUpdate: 0,
  pendingChunk: null,
});

function SceneController({ media, onTextureProgress, activeCategory = "all", onMediaClick, debugElRef, tuningGenVersion, showGuides, splashSrc, splashAspect }: { media: MediaItem[]; onTextureProgress?: (progress: number) => void; activeCategory?: string; onMediaClick?: (item: MediaItem, rect: { x: number; y: number; width: number; height: number }) => void; debugElRef?: React.RefObject<HTMLDivElement | null>; tuningGenVersion?: number; showGuides?: boolean; splashSrc?: string; splashAspect?: number }) {
  const { camera, gl } = useThree();
  const isTouchDevice = useIsTouchDevice();
  const [, getKeys] = useKeyboardControls<keyof KeyboardKeys>();

  const state = React.useRef<ControllerState>(createInitialState(INITIAL_CAMERA_Z));
  const cameraGridRef = React.useRef<CameraGridState>({
    cx: 0,
    cy: 0,
    cz: 0,
    camZ: INITIAL_CAMERA_Z,
    camX: 0,
    scrollDelta: 0,
    cumulativeScroll: 0,
    activeCategory: "all",
  });

  const [chunks, setChunks] = React.useState<ChunkData[]>([]);

  const { progress } = useProgress();
  const maxProgress = React.useRef(0);

  React.useEffect(() => {
    const rounded = Math.round(progress);
    if (rounded > maxProgress.current) {
      maxProgress.current = rounded;
      onTextureProgress?.(rounded);
    }
  }, [progress, onTextureProgress]);

  React.useEffect(() => {
    const canvas = gl.domElement;
    const s = state.current;
    canvas.style.cursor = "grab";

    const setCursor = (cursor: string) => {
      canvas.style.cursor = cursor;
    };

    const onMouseDown = (e: MouseEvent) => {
      s.isDragging = true;
      s.lastMouse = { x: e.clientX, y: e.clientY };
      setCursor("grabbing");
    };

    const onMouseUp = () => {
      s.isDragging = false;
      setCursor("grab");
    };

    const onMouseLeave = () => {
      s.mouse = { x: 0, y: 0 };
      s.isDragging = false;
      setCursor("grab");
    };

    const onMouseMove = (e: MouseEvent) => {
      s.mouse = {
        x: (e.clientX / window.innerWidth) * 2 - 1,
        y: -(e.clientY / window.innerHeight) * 2 + 1,
      };

      if (s.isDragging) {
        s.targetVel.x -= (e.clientX - s.lastMouse.x) * 0.025;
        s.targetVel.y += (e.clientY - s.lastMouse.y) * 0.025;
        s.lastMouse = { x: e.clientX, y: e.clientY };
      }
    };

    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      s.scrollAccum += e.deltaY * 0.012;
    };

    const onTouchStart = (e: TouchEvent) => {
      e.preventDefault();
      s.lastTouches = Array.from(e.touches) as Touch[];
      s.lastTouchDist = getTouchDistance(s.lastTouches);
      setCursor("grabbing");
    };

    const onTouchMove = (e: TouchEvent) => {
      e.preventDefault();
      const touches = Array.from(e.touches) as Touch[];

      if (touches.length === 1 && s.lastTouches.length >= 1) {
        const [touch] = touches;
        const [last] = s.lastTouches;
        if (touch && last) {
          s.targetVel.x -= (touch.clientX - last.clientX) * 0.02;
          s.targetVel.y += (touch.clientY - last.clientY) * 0.02;
        }
      } else if (touches.length === 2 && s.lastTouchDist > 0) {
        const dist = getTouchDistance(touches);
        s.scrollAccum += (s.lastTouchDist - dist) * 0.006;
        s.lastTouchDist = dist;
      }

      s.lastTouches = touches;
    };

    const onTouchEnd = (e: TouchEvent) => {
      s.lastTouches = Array.from(e.touches) as Touch[];
      s.lastTouchDist = getTouchDistance(s.lastTouches);
      setCursor("grab");
    };

    canvas.addEventListener("mousedown", onMouseDown);
    window.addEventListener("mouseup", onMouseUp);
    window.addEventListener("mousemove", onMouseMove);
    canvas.addEventListener("mouseleave", onMouseLeave);
    canvas.addEventListener("wheel", onWheel, { passive: false });
    canvas.addEventListener("touchstart", onTouchStart, { passive: false });
    canvas.addEventListener("touchmove", onTouchMove, { passive: false });
    canvas.addEventListener("touchend", onTouchEnd, { passive: false });

    return () => {
      canvas.removeEventListener("mousedown", onMouseDown);
      window.removeEventListener("mouseup", onMouseUp);
      window.removeEventListener("mousemove", onMouseMove);
      canvas.removeEventListener("mouseleave", onMouseLeave);
      canvas.removeEventListener("wheel", onWheel);
      canvas.removeEventListener("touchstart", onTouchStart);
      canvas.removeEventListener("touchmove", onTouchMove);
      canvas.removeEventListener("touchend", onTouchEnd);
    };
  }, [gl]);

  useFrame(() => {
    const s = state.current;
    const now = performance.now();

    const { left, right, up, down } = getKeys();
    if (left) s.targetVel.x -= KEYBOARD_SPEED;
    if (right) s.targetVel.x += KEYBOARD_SPEED;
    if (down) s.targetVel.y -= KEYBOARD_SPEED;
    if (up) s.targetVel.y += KEYBOARD_SPEED;

    // Z velocity driven by scroll — applied to image depth offsets, NOT camera Z
    s.targetVel.z += s.scrollAccum;
    s.scrollAccum *= 0.8;

    const isZooming = Math.abs(s.velocity.z) > 0.05;
    const zoomFactor = clamp(s.basePos.z / 50, 0.3, 2.0);
    const driftAmount = 8.0 * zoomFactor;
    const driftLerp = isZooming ? 0.2 : 0.12;

    if (s.isDragging) {
      // Freeze drift during drag
    } else if (isTouchDevice) {
      s.drift.x = lerp(s.drift.x, 0, driftLerp);
      s.drift.y = lerp(s.drift.y, 0, driftLerp);
    } else {
      s.drift.x = lerp(s.drift.x, s.mouse.x * driftAmount, driftLerp);
      s.drift.y = lerp(s.drift.y, s.mouse.y * driftAmount, driftLerp);
    }

    s.targetVel.x = clamp(s.targetVel.x, -MAX_VELOCITY, MAX_VELOCITY);
    s.targetVel.y = clamp(s.targetVel.y, -MAX_VELOCITY, MAX_VELOCITY);
    s.targetVel.z = clamp(s.targetVel.z, -MAX_VELOCITY, MAX_VELOCITY);

    s.velocity.x = lerp(s.velocity.x, s.targetVel.x, VELOCITY_LERP);
    s.velocity.y = lerp(s.velocity.y, s.targetVel.y, VELOCITY_LERP);
    s.velocity.z = lerp(s.velocity.z, s.targetVel.z, VELOCITY_LERP);

    s.basePos.x += s.velocity.x;
    s.basePos.y += s.velocity.y;
    // s.basePos.z intentionally not updated — camera Z is fixed at INITIAL_CAMERA_Z

    s.targetVel.x *= VELOCITY_DECAY;
    s.targetVel.y *= VELOCITY_DECAY;
    s.targetVel.z *= VELOCITY_DECAY;

    // Camera moves only in XY; Z is fixed so all images stay in the same depth reference frame
    camera.position.set(s.basePos.x + s.drift.x, s.basePos.y + s.drift.y, INITIAL_CAMERA_Z);

    const cx = Math.floor(s.basePos.x / CHUNK_SIZE);
    const cy = Math.floor(s.basePos.y / CHUNK_SIZE);
    const cz = Math.floor(INITIAL_CAMERA_Z / CHUNK_SIZE);

    const newCumScroll = cameraGridRef.current.cumulativeScroll + s.velocity.z;
    cameraGridRef.current = {
      cx,
      cy,
      cz,
      camZ: INITIAL_CAMERA_Z,
      camX: s.basePos.x,
      scrollDelta: s.velocity.z,
      cumulativeScroll: newCumScroll,
      activeCategory,
    };

    const debugEl = debugElRef?.current;
    if (debugEl) {
      debugEl.textContent =
        `pos    x:${s.basePos.x.toFixed(0).padStart(7)}  y:${s.basePos.y.toFixed(0).padStart(7)}\n` +
        `chunk  cx:${String(cx).padStart(3)}  cy:${String(cy).padStart(3)}\n` +
        `vel.z  ${s.velocity.z.toFixed(3).padStart(8)}  zoom:${isZooming ? "Y" : "N"}\n` +
        `cumScroll  ${newCumScroll.toFixed(1)}`;
    }

    const key = `${cx},${cy},${cz}`;
    if (key !== s.lastChunkKey) {
      s.pendingChunk = { cx, cy, cz };
      s.lastChunkKey = key;
    }

    const throttleMs = getChunkUpdateThrottleMs(isZooming, Math.abs(s.velocity.z));

    if (s.pendingChunk && shouldThrottleUpdate(s.lastChunkUpdate, throttleMs, now)) {
      const { cx: ucx, cy: ucy, cz: ucz } = s.pendingChunk;
      s.pendingChunk = null;
      s.lastChunkUpdate = now;

      setChunks(
        CHUNK_OFFSETS.map((o) => ({
          key: `${ucx + o.dx},${ucy + o.dy},${ucz + o.dz},v${tuningGenVersion ?? 0}`,
          cx: ucx + o.dx,
          cy: ucy + o.dy,
          cz: ucz + o.dz,
        })),
      );
    }
  });

  React.useEffect(() => {
    const s = state.current;
    s.basePos = { x: camera.position.x, y: camera.position.y, z: INITIAL_CAMERA_Z };

    setChunks(
      CHUNK_OFFSETS.map((o) => ({
        key: `${o.dx},${o.dy},${o.dz},v${tuningGenVersion ?? 0}`,
        cx: o.dx,
        cy: o.dy,
        cz: o.dz,
      })),
    );
  }, [camera]);

  React.useEffect(() => {
    if (!tuningGenVersion) return;
    const { cx, cy, cz } = cameraGridRef.current;
    setChunks(
      CHUNK_OFFSETS.map((o) => ({
        key: `${cx + o.dx},${cy + o.dy},${cz + o.dz},v${tuningGenVersion}`,
        cx: cx + o.dx,
        cy: cy + o.dy,
        cz: cz + o.dz,
      })),
    );
  }, [tuningGenVersion]);

  return (
    <>
      {chunks.map((chunk) => (
        <Chunk key={chunk.key} cx={chunk.cx} cy={chunk.cy} cz={chunk.cz} media={media} cameraGridRef={cameraGridRef} onMediaClick={onMediaClick} showLabel={!!debugElRef && (showGuides ?? true)} />
      ))}
      {splashSrc && <SplashPlane src={splashSrc} aspect={splashAspect ?? 16 / 9} cameraGridRef={cameraGridRef} />}
    </>
  );
}

export function InfiniteCanvasScene({
  media,
  onTextureProgress,
  onMediaClick,
  showFps = false,
  showControls = false,
  showDebug = false,
  showTuning = false,
  cameraFov = 60,
  cameraNear = 1,
  cameraFar = 500,
  fogNear = 120,
  fogFar = 320,
  backgroundColor = "#ffffff",
  fogColor = "#ffffff",
  activeCategory = "all",
  splashSrc,
  splashAspect,
}: InfiniteCanvasProps) {
  const debugElRef = React.useRef<HTMLDivElement>(null);
  const isTouchDevice = useIsTouchDevice();
  const dpr = Math.min(window.devicePixelRatio || 1, isTouchDevice ? 1.25 : 1.5);
  const [tuningGenVersion, setTuningGenVersion] = React.useState(0);
  const [panelOpen, setPanelOpen] = React.useState(false);
  const [showGuides, setShowGuides] = React.useState(false);
  const [tv, setTv] = React.useState({
    itemsPerChunk: tuning.itemsPerChunk,
    minSize: tuning.minSize,
    maxSize: tuning.maxSize,
    depthFadeNear: tuning.depthFadeNear,
    depthFadeStart: tuning.depthFadeStart,
    depthFadeEnd: tuning.depthFadeEnd,
    zSpread: tuning.zSpread,
  });

  const bumpGen = () => {
    clearPlaneCache();
    setTuningGenVersion((v) => v + 1);
  };

  // Stable reference — prevents R3F from resetting camera position on every parent re-render
  const cameraPos = React.useMemo<[number, number, number]>(() => [0, 0, INITIAL_CAMERA_Z], []);

  if (!media.length) return null;

  return (
    <KeyboardControls map={KEYBOARD_MAP}>
      <div className={styles.container}>
        <Canvas
          camera={{ position: cameraPos, fov: cameraFov, near: cameraNear, far: cameraFar }}
          dpr={dpr}
          flat
          gl={{ antialias: false, powerPreference: "high-performance" }}
          className={styles.canvas}
        >
          <color attach="background" args={[backgroundColor]} />
          <fog attach="fog" args={[fogColor, fogNear, fogFar]} />
          <SceneController media={media} onTextureProgress={onTextureProgress} activeCategory={activeCategory} onMediaClick={onMediaClick} debugElRef={showDebug ? debugElRef : undefined} tuningGenVersion={tuningGenVersion} showGuides={showGuides} splashSrc={splashSrc} splashAspect={splashAspect} />
          {showFps && <Stats className={styles.stats} />}
        </Canvas>

        {showControls && (
          <div className={styles.controlsPanel}>
            {isTouchDevice ? (
              <>
                <b>Drag</b> Pan · <b>Pinch</b> Zoom
              </>
            ) : (
              <>
                <b>WASD</b> Move · <b>QE</b> Up/Down · <b>Scroll</b> Zoom
              </>
            )}
          </div>
        )}
        {showDebug && <div ref={debugElRef} className={styles.debugPanel} />}
        {showTuning && (
          <div className={styles.tuningPanel}>
            <div className={styles.tuningPanelHeader}>
              <span>Tuning</span>
              <button type="button" className={styles.tuningToggle} onClick={() => setPanelOpen(o => !o)}>
                {panelOpen ? '−' : '+'}
              </button>
            </div>
            {panelOpen && (
              <>
                <label>
                  <span className={styles.labelRow}>
                    Density {tv.itemsPerChunk}
                    <span className={styles.info} data-tip="Images per chunk cell. Higher = denser canvas.">ⓘ</span>
                  </span>
                  <input type="range" min={1} max={4} step={1} value={tv.itemsPerChunk}
                    onChange={e => { const v = +e.target.value; tuning.itemsPerChunk = v; setTv(t => ({...t, itemsPerChunk: v})); bumpGen(); }} />
                </label>
                <label>
                  <span className={styles.labelRow}>
                    Min size {tv.minSize}
                    <span className={styles.info} data-tip="Smallest image size in world units.">ⓘ</span>
                  </span>
                  <input type="range" min={10} max={50} value={tv.minSize}
                    onChange={e => { const v = +e.target.value; tuning.minSize = v; setTv(t => ({...t, minSize: v})); bumpGen(); }} />
                </label>
                <label>
                  <span className={styles.labelRow}>
                    Max size {tv.maxSize}
                    <span className={styles.info} data-tip="Largest image size in world units.">ⓘ</span>
                  </span>
                  <input type="range" min={15} max={70} value={tv.maxSize}
                    onChange={e => { const v = +e.target.value; tuning.maxSize = v; setTv(t => ({...t, maxSize: v})); bumpGen(); }} />
                </label>
                <label>
                  <span className={styles.labelRow}>
                    Fade in end {tv.depthFadeNear}
                    <span className={styles.info} data-tip="Depth at which images reach full opacity after entering. Lower = faster fade-in.">ⓘ</span>
                  </span>
                  <input type="range" min={5} max={150} step={5} value={tv.depthFadeNear}
                    onChange={e => { const v = +e.target.value; tuning.depthFadeNear = v; setTv(t => ({...t, depthFadeNear: v})); }} />
                </label>
                <label>
                  <span className={styles.labelRow}>
                    Fade out start {tv.depthFadeStart}
                    <span className={styles.info} data-tip="Depth at which images begin fading out. Higher = images stay fully visible longer.">ⓘ</span>
                  </span>
                  <input type="range" min={50} max={950} step={10} value={tv.depthFadeStart}
                    onChange={e => { const v = +e.target.value; tuning.depthFadeStart = v; setTv(t => ({...t, depthFadeStart: v})); }} />
                </label>
                <label>
                  <span className={styles.labelRow}>
                    Cycle length {tv.depthFadeEnd}
                    <span className={styles.info} data-tip="Full depth cycle before an image wraps back. Higher = longer between repeat appearances.">ⓘ</span>
                  </span>
                  <input type="range" min={300} max={2000} step={10} value={tv.depthFadeEnd}
                    onChange={e => { const v = +e.target.value; tuning.depthFadeEnd = v; setTv(t => ({...t, depthFadeEnd: v})); bumpGen(); }} />
                </label>
                <label>
                  <span className={styles.labelRow}>
                    Z spacing {tv.zSpread}
                    <span className={styles.info} data-tip="How spread out images are across the depth cycle. High = images at very different depths (more Z gap). Low = images clustered at similar depths.">ⓘ</span>
                  </span>
                  <input type="range" min={50} max={tv.depthFadeEnd} step={10} value={Math.min(tv.zSpread, tv.depthFadeEnd)}
                    onChange={e => { const v = +e.target.value; tuning.zSpread = v; setTv(t => ({...t, zSpread: v})); bumpGen(); }} />
                </label>
                {showDebug && (
                  <button type="button" className={styles.tuningToggle} style={{ alignSelf: "flex-start", marginTop: 4 }} onClick={() => setShowGuides(g => !g)}>
                    {showGuides ? "Hide guides" : "Show guides"}
                  </button>
                )}
              </>
            )}
          </div>
        )}
      </div>
    </KeyboardControls>
  );
}
