# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

A photography portfolio website built as a 3D infinite pannable space. Uses React 19 + React Compiler, Three.js, React Three Fiber, TypeScript, and Vite.

## Git workflow

After every meaningful change: stage specific files, commit with a clear message, and push to `origin main`.

```bash
git add <files>
git commit -m "concise description of what and why"
git push origin main
```

Repository: `https://github.com/the-005/rh`

## Commands

Node 22 is required (see `.nvmrc`). Node is installed via Homebrew — prefix commands with `export PATH="/opt/homebrew/opt/node@22/bin:$PATH" &&` if `npm` is not in PATH.

```bash
npm run dev          # start dev server (network accessible)
npm run build        # TypeScript compile + Vite bundle
npm run check        # type check + lint (run before committing)
npm run check:types  # TypeScript only
npm run check:biome  # Biome lint only
npm run format       # auto-format with Biome
```

Linting/formatting is **Biome** (not ESLint/Prettier). Config in `biome.jsonc`.

## Architecture

### Data flow
`src/images/manifest.json` → `App` → `InfiniteCanvas` → Three.js scene

Media items are `{ url, width, height, project?, category? }`. Images live in `public/images/`. Items with a matching `project` field are grouped into a project page accessible by clicking the image.

### Key modules

**`src/infinite-canvas/`** — the core 3D engine:
- `scene.tsx` — four components: `InfiniteCanvasScene` (Canvas setup, fog, DPR, tuning panel UI), `SceneController` (input + chunk management), `Chunk` (spatial cell + debug labels), `MediaPlane` (single image plane with depth cycling + fade). Also contains `ChunkLabel` (debug wireframe + coord sprite).
- `constants.ts` — physics/render constants. `CHUNK_OFFSETS` defines the 3D grid of visible chunks (currently dz = −1..1, dx/dy = −3..3).
- `tuning.ts` — mutable singleton `tuning` object read live by `useFrame` and `generateChunkPlanes`. Sliders in the tuning panel write directly to this object; changes take effect without remounting except for generation params (density, size, cycle length, Z spacing) which call `bumpGen()` to clear the plane cache and increment `tuningGenVersion`.
- `texture-manager.ts` — texture loading/caching; calls `onTextureProgress`.
- `utils.ts` — `generateChunkPlanes` (seeded RNG, QMC depth phases, staggered-lattice XY placement), LRU plane cache (max 256 entries), chunk update throttle logic.

**`src/app/index.tsx`** — root `App`; wires manifest → `InfiniteCanvas` + `PageLoader` + `Frame`.

**`src/frame/index.tsx`** — HTML overlay header with category filter buttons (all / art / commerce).

**`src/loader/index.tsx`** — loading progress overlay (0–1 driven by texture load).

### Performance patterns

**`cameraGridRef`**: A `React.RefObject<CameraGridState>` shared with every `MediaPlane`. Updated each frame in `SceneController.useFrame`; planes read `scrollDelta`, `camX`, `cumulativeScroll`, and `activeCategory` without causing React re-renders.

**Two-stage velocity**: Input accumulates into `targetVel`. Each frame, `velocity` lerps toward `targetVel` (smoothing), then `targetVel` is multiplied by `VELOCITY_DECAY` (friction). Mouse parallax `drift` is separate.

**Depth cycling (scroll zoom effect)**: Scrolling drives `velocity.z` applied to each image's `absoluteZOffset` rather than moving the camera. `effectiveZ = INITIAL_CAMERA_Z - zOffset`. Images right of camera zoom in on scroll-up; left zoom out. Opacity fade zones: `depthFadeNear` (fade in), flat visible plateau, `depthFadeStart` → `depthFadeEnd` (fade out + wrap back to 0).

**Depth phase assignment** (`PlaneData.depthPhase`): Pre-computed in `generateChunkPlanes`. All planes in an XY chunk column (3 z-layers × `itemsPerChunk`) are stratified onto evenly spaced depth slots (`zSpread / (3 × itemsPerChunk)` apart — 150 units at defaults). Each column's base phase comes from `frac(cx·ALPHA_X + cy·ALPHA_Y + sessionFrac)` with constants grid-search-optimized so nearby columns' phases avoid each other's slots — worst-case arrival gap between any two nearby planes is ~27 units (2×2 column window) / ~14 (3×3), near the pigeonhole optimum. Guarantees a steady one-at-a-time arrival stream instead of images arriving in batches.

**XY placement**: Staggered lattice (`LATTICE_SITES` in `utils.ts`) — each chunk's items sit on fixed fractional sites (diagonal pair for density 2; odd z-layers use the anti-diagonal so layers interleave) plus a deterministic jitter (radius `JITTER_RADIUS`). The union across chunks tiles uniformly, capping worst-case empty regions at ~half a chunk while keeping every pair of images ≥83 units apart. Jitter seed includes `SESSION_SEED + cx + cy + cz + item index + cycleNumber` so positions vary per session and per depth cycle.

**Chunk throttling**: Chunk list updates throttle to 100 ms normally, 400–500 ms while zooming fast.

**React Compiler**: `babel-plugin-react-compiler` is active. Do not add manual `useMemo`/`useCallback`.

### Tuning panel

`InfiniteCanvasScene` renders a collapsible tuning panel (visible when `showTuning` prop is true, collapsed by default). Sliders mirror their values into a `tv` React state object (required because React Compiler memoizes direct reads of the stable `tuning` object). Generation-affecting sliders call `bumpGen()` which clears the plane LRU cache and bumps `tuningGenVersion`, causing `SceneController` to immediately remount all chunks.

### Debug system

When `showDebug` is true:
- Bottom-left HUD shows camera pos, chunk coords, vel.z, cumScroll.
- Each `MediaPlane` renders an orange canvas-sprite label showing `cx,cy,cz #index`, visible only when the image is visible.
- Each `Chunk` renders a `ChunkLabel` (blue wireframe + coord sprite) when `showGuides` is also true (toggled via "Show/Hide guides" button in the tuning panel, hidden by default).

### Current tuned values

| What | Location | Value |
|---|---|---|
| Chunk size | `CHUNK_SIZE` in `constants.ts` | 160 |
| Z layers rendered | `CHUNK_OFFSETS` dz loop | −1..1 (3 layers) |
| Images per chunk | `tuning.itemsPerChunk` in `tuning.ts` | 2 |
| Plane size range | `tuning.minSize` / `tuning.maxSize` | 22–30 units |
| Depth cycle length | `tuning.depthFadeEnd` | 900 |
| Z spread (within-chunk) | `tuning.zSpread` | 900 |
| Velocity decay | `VELOCITY_DECAY` in `constants.ts` | 0.96 |
| Velocity smoothing | `VELOCITY_LERP` in `constants.ts` | 0.08 |
| Scroll sensitivity | `s.scrollAccum += e.deltaY * 0.012` in `scene.tsx` | 0.012 |
| Camera FOV | `cameraFov={48}` in `src/app/index.tsx` | 48° |

### Path alias
`~` resolves to the repo root (configured in `vite.config.ts`). Imports look like `~/src/utils`.
