import { KeyboardControls, Stats, useKeyboardControls, useProgress } from "@react-three/drei";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import * as React from "react";
import * as THREE from "three";
import { useIsTouchDevice } from "~/src/use-is-touch-device";
import { clamp, hashString, lerp, seededRandom } from "~/src/utils";
import {
  CHUNK_FADE_MARGIN,
  CHUNK_OFFSETS,
  CHUNK_SIZE,
  DEPTH_FADE_END,
  DEPTH_FADE_START,
  INITIAL_CAMERA_Z,
  INVIS_THRESHOLD,
  KEYBOARD_SPEED,
  MAX_VELOCITY,
  NEAR_FADE_END,
  RENDER_DISTANCE,
  VELOCITY_DECAY,
  VELOCITY_LERP,
} from "./constants";
import styles from "./style.module.css";
import { getTexture } from "./texture-manager";
import type { ChunkData, InfiniteCanvasProps, MediaItem, PlaneData } from "./types";
import { generateChunkPlanesCached, getChunkUpdateThrottleMs, shouldThrottleUpdate } from "./utils";

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
  activeCategory: string;
};

function MediaPlane({
  position,
  scale,
  mediaPool,
  mediaIndex,
  depthPhase,
  chunkCx,
  chunkCy,
  chunkCz,
  cameraGridRef,
  onMediaClick,
}: {
  position: THREE.Vector3;
  scale: THREE.Vector3;
  mediaPool: MediaItem[];
  mediaIndex: number;
  depthPhase: number;
  chunkCx: number;
  chunkCy: number;
  chunkCz: number;
  cameraGridRef: React.RefObject<CameraGridState>;
  onMediaClick?: (item: MediaItem, rect: { x: number; y: number; width: number; height: number }) => void;
}) {
  const meshRef = React.useRef<THREE.Mesh>(null);
  const materialRef = React.useRef<THREE.MeshBasicMaterial>(null);
  const localState = React.useRef({ opacity: 0, ready: false, absoluteZOffset: depthPhase, lastCycle: 0, swapPending: false, filterFade: false, cycleX: position.x, cycleY: position.y });

  const [cycleIndex, setCycleIndex] = React.useState(0);
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

    const zOffset = ((state.absoluteZOffset % DEPTH_FADE_END) + DEPTH_FADE_END) % DEPTH_FADE_END;

    // Snap opacity to 0 and swap image whenever the plane crosses a depth cycle boundary
    const newCycle = Math.floor(state.absoluteZOffset / DEPTH_FADE_END);
    if (newCycle !== state.lastCycle) {
      state.lastCycle = newCycle;
      state.opacity = 0;
      state.swapPending = false; // re-evaluate category match on next frame
      setCycleIndex(newCycle);
      // Relocate to a fresh random spot within the chunk so each cycle
      // appears at a new position with a potentially different trajectory.
      const cs = hashString(`${chunkCx},${chunkCy},${chunkCz},${newCycle}`);
      state.cycleX = chunkCx * CHUNK_SIZE + seededRandom(cs) * CHUNK_SIZE;
      state.cycleY = chunkCy * CHUNK_SIZE + (seededRandom(cs + 1) - 0.5) * CHUNK_SIZE;
    }

    const effectiveZ = INITIAL_CAMERA_Z - zOffset;
    mesh.position.x = state.cycleX;
    mesh.position.y = state.cycleY;
    mesh.position.z = effectiveZ;

    const cam = cameraGridRef.current;
    const dist = Math.max(Math.abs(chunkCx - cam.cx), Math.abs(chunkCy - cam.cy), Math.abs(chunkCz - cam.cz));
    const absDepth = zOffset;

    if (zOffset > DEPTH_FADE_END + 50) {
      state.opacity = 0;
      material.opacity = 0;
      material.depthWrite = false;
      mesh.visible = false;
      return;
    }

    const gridFade =
      dist <= RENDER_DISTANCE ? 1 : Math.max(0, 1 - (dist - RENDER_DISTANCE) / Math.max(CHUNK_FADE_MARGIN, 0.0001));

    const depthFade =
      absDepth <= NEAR_FADE_END
        ? absDepth / NEAR_FADE_END
        : absDepth <= DEPTH_FADE_START
          ? 1
          : Math.max(0, 1 - (absDepth - DEPTH_FADE_START) / Math.max(DEPTH_FADE_END - DEPTH_FADE_START, 0.0001));

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
    mesh.visible = state.opacity > INVIS_THRESHOLD;
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
    // biome-ignore lint/a11y/noStaticElementInteractions: Three.js mesh is not a DOM element
    <mesh
      ref={meshRef}
      position={position}
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
  );
}

function Chunk({
  cx,
  cy,
  cz,
  media,
  cameraGridRef,
  onMediaClick,
}: {
  cx: number;
  cy: number;
  cz: number;
  media: MediaItem[];
  cameraGridRef: React.RefObject<CameraGridState>;
  onMediaClick?: (item: MediaItem, rect: { x: number; y: number; width: number; height: number }) => void;
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
          chunkCx={cx}
          chunkCy={cy}
          chunkCz={cz}
          cameraGridRef={cameraGridRef}
          onMediaClick={onMediaClick}
        />
      ))}
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

function SceneController({ media, onTextureProgress, activeCategory = "all", onMediaClick }: { media: MediaItem[]; onTextureProgress?: (progress: number) => void; activeCategory?: string; onMediaClick?: (item: MediaItem, rect: { x: number; y: number; width: number; height: number }) => void }) {
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
      s.scrollAccum += e.deltaY * 0.002;
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
    s.scrollAccum *= 0.85;

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

    cameraGridRef.current = {
      cx,
      cy,
      cz,
      camZ: INITIAL_CAMERA_Z,
      camX: s.basePos.x,
      scrollDelta: s.velocity.z,
      activeCategory,
    };

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
          key: `${ucx + o.dx},${ucy + o.dy},${ucz + o.dz}`,
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
        key: `${o.dx},${o.dy},${o.dz}`,
        cx: o.dx,
        cy: o.dy,
        cz: o.dz,
      })),
    );
  }, [camera]);

  return (
    <>
      {chunks.map((chunk) => (
        <Chunk key={chunk.key} cx={chunk.cx} cy={chunk.cy} cz={chunk.cz} media={media} cameraGridRef={cameraGridRef} onMediaClick={onMediaClick} />
      ))}
    </>
  );
}

export function InfiniteCanvasScene({
  media,
  onTextureProgress,
  onMediaClick,
  showFps = false,
  showControls = false,
  cameraFov = 60,
  cameraNear = 1,
  cameraFar = 500,
  fogNear = 120,
  fogFar = 320,
  backgroundColor = "#ffffff",
  fogColor = "#ffffff",
  activeCategory = "all",
}: InfiniteCanvasProps) {
  const isTouchDevice = useIsTouchDevice();
  const dpr = Math.min(window.devicePixelRatio || 1, isTouchDevice ? 1.25 : 1.5);

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
          <SceneController media={media} onTextureProgress={onTextureProgress} activeCategory={activeCategory} onMediaClick={onMediaClick} />
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
      </div>
    </KeyboardControls>
  );
}
