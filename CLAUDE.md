# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

A photography portfolio website built as a 3D infinite pannable space — bootstrapped from [edoardolunardi/infinite-canvas](https://github.com/edoardolunardi/infinite-canvas). Uses React 19 + React Compiler, Three.js, React Three Fiber, TypeScript, and Vite.

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
`src/artworks/manifest.json` → `App` → `InfiniteCanvas` → Three.js scene

Media items are `{ url, width, height }`. To swap in your own photos, replace `public/artworks/` images and update `src/artworks/manifest.json` to match (see `scripts/download-artworks.ts` for the manifest shape).

### Key modules

**`src/infinite-canvas/`** — the core 3D engine:
- `scene.tsx` — four components: `InfiniteCanvasScene` (Canvas setup, fog, DPR), `SceneController` (input + chunk management), `Chunk` (spatial cell), `MediaPlane` (single image plane with depth cycling + fade)
- `constants.ts` — all tunable physics/render values. Edit here to change feel.
- `texture-manager.ts` — texture loading/caching; calls `onTextureProgress`
- `utils.ts` — plane generation (3 planes/chunk, sizes 12–20 units, seeded RNG from chunk coords), LRU plane cache (max 256 entries), chunk update throttle logic

**`src/app/index.tsx`** — root `App`; wires manifest → `InfiniteCanvas` + `PageLoader` + `Frame`

**`src/frame/index.tsx`** — HTML overlay header. Replace content here for portfolio branding.

**`src/loader/index.tsx`** — loading progress overlay (0–1 driven by texture load).

### Performance patterns

**`cameraGridRef`**: A `React.RefObject<CameraGridState>` shared with every `MediaPlane`. Contains chunk-grid coords (`cx/cy/cz`), `camX` (world-space camera X), and `scrollDelta` (per-frame Z velocity). Planes read it each frame in `useFrame` without React re-renders — critical for smooth animation.

**Two-stage velocity**: Input accumulates into `targetVel`. Each frame, `velocity` is lerped toward `targetVel` (smoothing), then `targetVel` is multiplied by `VELOCITY_DECAY` (friction). `drift` is a separate parallax offset from mouse position, not part of velocity.

**Depth cycling (scroll zoom effect)**: Scrolling drives `velocity.z` which moves each image through a `[0, DEPTH_FADE_END)` depth cycle rather than moving the camera. `effectiveZ = INITIAL_CAMERA_Z - zOffset`. Images left of camera zoom out on scroll-up; images right zoom in. The cycle uses opacity fade zones: `NEAR_FADE_END` (fade in near camera), fully visible to `DEPTH_FADE_START`, then fade out to `DEPTH_FADE_END` where the image wraps invisibly back to 0.

**Depth phase assignment** (`PlaneData.depthPhase`): Each image's starting position in the depth cycle is pre-computed in `generateChunkPlanes`. Within a chunk, 3 images are assigned evenly-spaced slots (`DEPTH_FADE_END / 3 ≈ 87` units apart). The per-chunk phase offset uses a golden-ratio sequence on chunk coordinates — this maximises the minimum gap between phases of different chunks, preventing depth collisions.

**Chunk throttling**: Chunk list updates are throttled to 100 ms normally, 400–500 ms while zooming fast, to avoid thrashing during rapid scroll.

**React Compiler**: `babel-plugin-react-compiler` is active. Do not add manual `useMemo`/`useCallback` — the compiler handles memoization.

### Customization props on `InfiniteCanvasScene`
`backgroundColor`, `fogColor`, `fogNear`, `fogFar`, `cameraFov`, `cameraNear`, `cameraFar`, `showFps` (debug), `showControls` (debug hint overlay).

### Path alias
`~` resolves to the repo root (configured in `vite.config.ts`). Imports look like `~/src/utils`.
