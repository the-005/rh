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

**`src/project/`** — project page + canvas↔page transition:
- `index.tsx` — `ProjectPage`: a three-part transition over one fit-to-width row (32px side margins, 4px gaps, row height capped at 50vh), on a white background matching the homepage. **Part 1 (arrival)** — the manifest is rotated so the clicked image leads, and the plane flies into that slot. **Parts 2+3, fused, 600ms** — the row order is *reversed* (`order.reverse()`, which is why the clicked image ends up last) and the new leading image blows up to `HERO_HEIGHT_FRAC` (50%) of viewport height, horizontally centred; all others stay at row height. **Part 3 browsing** — the left half of the screen is previous, the right half is next (plus arrow keys); the split sits on the viewport centre, which is also the enlarged image's centre, so the image needs no special case. **Exit, three beats** — settle back to row height with **the image you were looking at staying centred** (it shrinks in place; anchoring to the margin instead threw it out to the right only to walk it back, and did nothing at all when you were already on the last one), then the settled row travels left until the arrival image is centred while the others **drop away staggered**, furthest-first, so the row empties toward the departing image, then it flies back to its own plane. 600 + 600 + 1000ms. During the flight the camera itself eases onto the plane's canvas slot (`setCameraGoal`), so the image lands in the middle of the screen rather than wherever you left the canvas — parallax is unwound to zero over the same clock or the landing sits off-centre by the drift offset. Closing is the × or Escape only — a click anywhere is now navigation. Every phase is a permutation or a scale of the same row, driven by transforms on `.slot` wrappers, so nothing ever relayouts.

  Phases are `arrive | hero | settle | centre | out`; slot transforms carry x and scale only — the staggered drop/fade rides the inner `<img>`, mirroring the entry rise and keeping React's layout out of the imperative animation's way.  `busy` freezes DOM input for the duration of any move (the canvas half of that freeze is `isCanvasFrozen`). The turn and every advance share one measured curve, `cubic-bezier(0.42, 0, 0.58, 1)`; only the flight is expo-out. Escape stays live mid-move and falls back to a plain fade, since the choreographed exit needs a settled row.
- `transition-origin.ts` — module-level store coordinating the persistent-plane transition (modeled on Codrops "persistent page transitions"): the clicked WebGL plane itself flies (expo-out, 1s) to the hero slot rect measured from the DOM, other planes dim, and canvas input freezes. Only when the plane is pinned at rest is the DOM `<img>` revealed and the plane hidden (`hideTransitionSource`), so the handoff is invisible. Supporting images stay hidden during flight and enter only after the hero lands: each rises 32px into its slot (0.7s expo-out) with a 0.07s left-to-right stagger. `releaseTransition()` (on close/unmount) un-hides, un-dims, and un-freezes; `holdTransition()` re-asserts the hold because StrictMode's double-invoked mount runs that release in between. The entry effect must only ever restore inline styles to `""` (the class value) — capturing "original" inline values breaks under StrictMode re-runs. The flight itself runs in `MediaPlane.useFrame` (`getHeroTween(regKey)` branch in `scene.tsx`); planes are addressed by registry key, not URL, because one image can appear on several planes. `beginHeroTween` takes a `mode`: `"in"` flies the plane from the canvas to a measured DOM rect, `"out"` re-pins it to wherever the row has since carried the image and flies it home. The run rebuilds whenever the mode changes, and `cycleX`/`cycleY`/`absoluteZOffset` stop updating once the branch takes over, so they still hold the plane's canvas slot — that is what "home" means.

**`src/frame/index.tsx`** — HTML overlay header. Two navs ride the top row: the category filter (all / art / commerce) at the left, the gallery/index view toggle at the right. Both inherit the frame's `mix-blend-mode: difference`, so they read white over the canvas and black over the index and project pages. The view toggle is hidden while a project is open (`showViewToggle`).

**`src/projects/index.ts`** — the manifest grouped into one entry per project slug, in manifest order: `{ id, title, year, category, count, cover }`. The manifest carries no titles and no dates, so titles are derived from the slug (`art-11` → "Art 11") and years from the filenames (`RH_ART2025_061.jpg` → 2025). Real names and dates go in the `OVERRIDES` map, keyed by slug — one field at a time, anything absent keeps the derived value.

**`src/index-page/index.tsx`** — `IndexPage`: the same projects read as a list instead of a space, on the white the project page uses. One row per project — number, title, year — sharing a single grid between header and rows so the columns line up. Hovering the list dims every row but the one under the cursor. It lives at the `/index` route (a route, not state, so it survives a reload and the back button), sits at `z-index: 100` under the frame, and respects the active category filter. A row hands off to `/project/:id` with no pending transition, so the project page takes its plain-fade fallback; closing returns you to whichever view opened it.

**`src/loader/index.tsx`** — loading progress overlay (0–1 driven by texture load).

### Performance patterns

**`cameraGridRef`**: A `React.RefObject<CameraGridState>` shared with every `MediaPlane`. Updated each frame in `SceneController.useFrame`; planes read `scrollDelta`, `camX`, `cumulativeScroll`, and `activeCategory` without causing React re-renders.

**Two-stage velocity**: Input accumulates into `targetVel`. Each frame, `velocity` lerps toward `targetVel` (smoothing), then `targetVel` is multiplied by `VELOCITY_DECAY` (friction). Mouse parallax `drift` is separate.

**Depth cycling (scroll zoom effect)**: Scrolling drives `velocity.z` applied to each image's `absoluteZOffset` rather than moving the camera. `effectiveZ = INITIAL_CAMERA_Z - zOffset`. Images right of camera zoom in on scroll-up; left zoom out — direction is re-evaluated against `camX` every frame, so planes flip direction when the camera pans past them. **This camera-relative flip is a non-negotiable design feature** — do not replace it with fixed per-plane directions. Its side effect (two planes can drift to identical depths and then move in lockstep, appearing welded together) is handled by the rest-time depth de-confliction pass in `MediaPlane` (`PlaneRegistry`): while the canvas is at rest, visible pairs closer than 50 depth units and 60 XY units are eased apart at 0.6 units/frame. Opacity fade zones: `depthFadeNear` (fade in), flat visible plateau, `depthFadeStart` → `depthFadeEnd` (fade out + wrap back to 0).

**Depth phase assignment** (`PlaneData.depthPhase`): Pre-computed in `generateChunkPlanes`. All planes in an XY chunk column (3 z-layers × `itemsPerChunk`) are stratified onto evenly spaced depth slots (`zSpread / (3 × itemsPerChunk)` apart — 150 units at defaults). Each column's base phase is `frac(cx·ALPHA_X + cy·ALPHA_Y + sessionFrac)`; the constants are grid-search-optimized so every pair within ±2 columns spawns ≥15.9 depth units apart, with a ±4-window guard against exact rational welds. Beware: constants in an exact rational ratio (e.g. 2:3) lock entire column sublattices to identical phases. Because directions are camera-relative, relative phases drift as the user pans — spawn spacing is a starting condition, and the de-confliction pass handles later convergence.

**XY placement**: Staggered lattice (`utils.ts`) — each chunk's items sit on fixed fractional sites plus a deterministic jitter (radius `JITTER_RADIUS`). For density 2, each of the three z-layers has its own site variant (`LATTICE_VARIANTS_N2`: diagonal / anti-diagonal / center+corner) so no two layers share sites (cross-layer ≥56.6 units pre-jitter). The union across chunks tiles uniformly, capping worst-case empty regions at ~half a chunk while keeping same-layer images ≥83 units apart. Jitter seed includes `SESSION_SEED + cx + cy + cz + item index + cycleNumber` so positions vary per session and per depth cycle.

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
| Camera FOV | `cameraFov={48}` in `src/app/index.tsx` | 48° vertical at aspect ≥ 1; widens on narrower viewports (horizontal-coverage floor, capped 95°) via `AdaptiveFov` in `scene.tsx` |

### Path alias
`~` resolves to the repo root (configured in `vite.config.ts`). Imports look like `~/src/utils`.
