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
npm run work:images -- "<client folder>"  # web copies of the Work images (see Media)
npm run research:images -- "<folder>"      # web copies of the Research images (see Media)
```

Linting/formatting is **Biome** (not ESLint/Prettier). Config in `biome.jsonc`.

## Media

The site has two sets of images. **Work** is what the canvas (gallery), the project pages and the index show; they share `src/work/manifest.json`. **Research** is the outlier: its own page and its own `src/research/manifest.json`. Say "Work" for the first set. "Project" means a single one.

Both scripts encode through `scripts/media.ts`, which follows the owner's manual Squoosh process so a scripted batch matches a hand-made one. Treat these settings as fixed; change them only when asked:

- **JPEG through MozJPEG (Squoosh's JPEG encoder), quality 85**, progressive.
- **Longest side 3000px, never enlarged.** It's a photography site, so keep the most resolution the cap allows; don't lower it to save bytes.
- Turned upright from the camera's rotation tag, converted to sRGB from any embedded profile, metadata stripped — as Squoosh does.
- **Order comes from the name**, natural sort (`_2` before `_10`). Don't reorder by hand; rename the source.
- Images only. Videos have no process yet.

Originals are never written. Copies newer than their source are skipped (`--force` redoes them).

**Work** — `npm run work:images -- "<client folder>"`. The client folder holds one folder per project. **The folder name is the project's title, used as-is** (`PR-02_HE`), and also its `/project/:id`. Images sit in subfolders (`PR-02_IMG`, `PR-01_IMAGES`) or loose; subfolders with `VID` in the name are skipped. Each image gets two copies: `public/work/<project>/<name>.jpg` at 3000px for the project page and index, and `public/work/<project>/canvas/<name>.jpg` at **1000px for the canvas**, which holds every texture on the GPU at once (3000px would be about 8GB for 245 images). The client folder is the source of truth: anything in `public/work/` it no longer accounts for is deleted, and `src/work/manifest.json` — `{ url, canvasUrl, width, height, project }[]` — is rebuilt every run. The client folder today is `~/Downloads/[optimize + format]`: 11 projects, PR-01_DE … PR-012_PV (no PR-10), 245 images.

**Research** — `npm run research:images -- "<source folder>"` writes `public/research/<name>.jpg`, then rebuilds `src/research/manifest.json` — `{ url, width, height }[]` — from everything in `public/research/`. Run it once per source folder. Its images are placeholders (PR-01_DE, which is also a Work project).

In the client's folders, images and videos mostly share one number sequence per project: the gaps in the image numbers are videos. Not every file follows it; PR-01 has `_64`/`_65` as both a JPEG and an MP4, some videos have unnumbered names (`DFC_P20_04.mp4`), and PR-04_FC's images aren't numbered at all (`FASHIONCLASH COVER.jpg`, `FC24_01.jpg` … `spatial 02.jpg`), so they sort by name.

## Typeface

The site's sans is **Neue Haas Grotesk Text** (Linotype/Monotype), set as `--font-sans` in `src/index.css`. It's served from `public/fonts/neue-haas-grotesk-text/`, six WOFF2 files (400/500/700, roman and italic) converted from the owner's desktop TTFs, and `regular.woff2` is preloaded in `index.html`. The fallback is Helvetica Neue/Arial; Google Fonts is no longer loaded. **Licence:** the TTFs are a desktop licence (workstation only, no distribution). The owner chose to serve them anyway while the site is unofficial and shared with friends. **It needs a web licence before launch.** The family has no Light, so the site's `font-weight: 300` renders as Regular.

**Case and tracking:** no `text-transform: uppercase` and no `letter-spacing`. Text is set as written, in sentence case (nav labels come from `LABELS` in `src/frame/index.tsx`), at the font's default spacing.

## Architecture

### Data flow
`src/work/manifest.json` → `App` → `InfiniteCanvas` → Three.js scene

Media items are `{ url, canvasUrl, width, height, project }`. Images live in `public/work/`; the canvas loads `canvasUrl` (1000px), everything else loads `url` (3000px). Items with a matching `project` field are grouped into a project page accessible by clicking the image. There is no category split (the old art/commerce filter is gone).

### Key modules

**`src/infinite-canvas/`** — the core 3D engine:
- `scene.tsx` — four components: `InfiniteCanvasScene` (Canvas setup, fog, DPR, tuning panel UI), `SceneController` (input + chunk management), `Chunk` (spatial cell + debug labels), `MediaPlane` (single image plane with depth cycling + fade). Also contains `ChunkLabel` (debug wireframe + coord sprite).
- `constants.ts` — physics/render constants. `CHUNK_OFFSETS` defines the 3D grid of visible chunks (currently dz = −1..1, dx/dy = −3..3).
- `tuning.ts` — mutable singleton `tuning` object read live by `useFrame` and `generateChunkPlanes`. Sliders in the tuning panel write directly to this object; changes take effect without remounting except for generation params (density, size, cycle length, Z spacing) which call `bumpGen()` to clear the plane cache and increment `tuningGenVersion`.
- `texture-manager.ts` — texture loading/caching, from each item's `canvasUrl` (the 1000px copy).
- `utils.ts` — `generateChunkPlanes` (seeded RNG, QMC depth phases, staggered-lattice XY placement), LRU plane cache (max 256 entries), chunk update throttle logic.

**`src/app/index.tsx`** — root `App`; wires manifest → `InfiniteCanvas` + `SplashVideo` + `Frame`. There is no loading overlay or progress bar (removed at the owner's request); planes simply fade in as their textures arrive.

**`src/project/`** — project page + canvas↔page transition:
- `index.tsx` — `ProjectPage`: a transition over one fit-to-width row (32px side margins, 4px gaps, row height capped at 50vh), on a white background matching the homepage. **Part 1 (arrival)** — the manifest is rotated so the clicked image leads, and the plane flies into that slot. **Part 2, 600ms** — no flip (the old full reversal of the row was removed as too much): once the row has arrived, the first image — the one you clicked, slot 0 — scales up to `HERO_HEIGHT_FRAC` (66%, matching dylan.camera; was 50%) of viewport height and moves to horizontal centre, the row sliding with it; all others stay at row height. The row keeps its arrival order in every phase, so "next" is always the image to the right and there is no previous from the clicked image. **Part 3 browsing** — the left half of the screen is previous, the right half is next, plus arrow keys, plus **wheel/trackpad** (down or right = next, as on serenacongiu.com). **One swipe is one image, never more** (the owner hit double steps from a too-eager detector): a step needs `WHEEL_STEP` (40px) of travel, then the wheel locks for the rest of that swipe, glide included. Only a second swipe unlocks it, and one made while the image is still moving queues the next image. The second swipe is detected conservatively. Nothing counts for `WHEEL_REFRACTORY_MS` (200) after the step. Speed is measured per frame, so browser-merged events don't read as a speed-up, and averaged over three events. The average must climb to `WHEEL_RESWIPE_RATIO` (2.5×) its slowest since and `WHEEL_RESWIPE_PX` (10) faster; a reversal or `WHEEL_QUIET_MS` (180ms) of silence also unlocks. This is tuned against simulated input only, so the owner's real trackpad is the test. A notch that lands mid-move is queued, and `preventDefault` stops a sideways swipe becoming browser-back; the split sits on the viewport centre, which is also the enlarged image's centre, so the image needs no special case. **Exit, three beats** — settle back to row height with **the image you were looking at staying centred** (it shrinks in place; anchoring to the margin instead threw it out to the right only to walk it back, and did nothing at all when you were already on the last one), then the settled row travels until the arrival image (slot 0) is centred while the others **drop away staggered**, furthest-first, so the row empties toward the departing image, then it flies back to its own plane. 600 + 600 + 1000ms. During the flight the camera itself eases onto the plane's canvas slot (`setCameraGoal`), so the image lands in the middle of the screen rather than wherever you left the canvas — parallax is unwound to zero over the same clock or the landing sits off-centre by the drift offset. Closing is the × or Escape only — a click anywhere is now navigation. Every phase is a permutation or a scale of the same row, driven by transforms on `.slot` wrappers, so nothing ever relayouts.

  Phases are `arrive | hero | settle | centre | out`; slot transforms carry x and scale only — the staggered drop/fade rides the inner `<img>`, mirroring the entry rise and keeping React's layout out of the imperative animation's way.  `busy` freezes DOM input for the duration of any move (the canvas half of that freeze is `isCanvasFrozen`). The turn and every advance share one measured curve, `cubic-bezier(0.42, 0, 0.58, 1)`; only the flight is expo-out. Escape stays live mid-move and falls back to a plain fade, since the choreographed exit needs a settled row.
- `transition-origin.ts` — module-level store coordinating the persistent-plane transition (modeled on Codrops "persistent page transitions"): the clicked WebGL plane itself flies (expo-out, 1s) to the hero slot rect measured from the DOM, other planes dim, and canvas input freezes. Only when the plane is pinned at rest is the DOM `<img>` revealed and the plane hidden (`hideTransitionSource`), so the handoff is invisible. Supporting images stay hidden during flight and enter only after the hero lands: each rises 32px into its slot (0.7s expo-out) with a 0.07s left-to-right stagger. `releaseTransition()` (on close/unmount) un-hides, un-dims, and un-freezes; `holdTransition()` re-asserts the hold because StrictMode's double-invoked mount runs that release in between. The entry effect must only ever restore inline styles to `""` (the class value) — capturing "original" inline values breaks under StrictMode re-runs. The flight itself runs in `MediaPlane.useFrame` (`getHeroTween(regKey)` branch in `scene.tsx`); planes are addressed by registry key, not URL, because one image can appear on several planes. `beginHeroTween` takes a `mode`: `"in"` flies the plane from the canvas to a measured DOM rect, `"out"` re-pins it to wherever the row has since carried the image and flies it home. The run rebuilds whenever the mode changes, and `cycleX`/`cycleY`/`absoluteZOffset` stop updating once the branch takes over, so they still hold the plane's canvas slot — that is what "home" means.

**`src/frame/index.tsx`** — HTML overlay header. The top row carries a `Home` wordmark at the left — a placeholder for the logo, and the way back to the canvas — and the view nav (gallery / index / research / about) at the right. Both inherit the frame's `mix-blend-mode: difference`, so they read white over the canvas and black over the index, about and project pages. The nav is hidden while a project is open (`showNav`).

**`src/about/index.tsx`** — `AboutPage`: the third view, and the only one that is words rather than pictures. Same paper as the index (white, the site's sans) so gallery → index → about is one material change. A statement column and a right-hand rail of contact / studio / services / clients. All the copy is placeholder standing in for the real text; the layout does not depend on its length. Lives at `/about`, sits at `z-index: 100` under the frame.

**`src/research/index.tsx`** — `ResearchPage`: the Research images as a grid, at `/research`, on the same white as the index and about. Started as the Codrops grid-layout-transition demo (MIT), with its numbering and GSAP FLIP tween removed and its scale buttons replaced by a slider (50–150%, centred in the frame's top row). The slider sets a target tile width (`BASE_TILE` 150px × scale). The grid is `repeat(auto-fill, minmax(--tile, 1fr))`, so it fits as many columns as the row holds, stretches them to fill it, and moves a column at a time with both edges fixed. Each change lands in a single frame, the way Eagle's zoom does (checked frame by frame against a recording); tweening tiles between cells read as lag. **Stops** at 50/75/100/125/150 **snap on release**: a drag moves freely, and letting go within `SNAP` (6) of a stop lands on it. Anything further out stays where it was released; `SNAP` 12.5 would make every release snap. Arrow keys never snap, or 101 would snap back to 100 and the thumb would stick. No value readout. Images keep their own aspect ratios and **hang from the top of each row** (`align-items: start`), not centred. Phones get 3 fixed columns and no slider. It reads `src/research/manifest.json` (see Media).

**`src/projects/index.ts`** — the Work manifest grouped into one entry per project, in manifest order: `{ id, title, year, count, cover, images }`. `id` and `title` are both the client's folder name, as-is, so renaming the folder retitles the project; routes encode it (`encodeURIComponent`) in case a name holds spaces. The manifest carries no dates: a year is read from a filename if one holds a 19xx/20xx, and none do today, so the index shows "—". Real years go in the `YEARS` map, keyed by folder name.

**`src/index-page/index.tsx`** — `IndexPage`: the same projects read as a list instead of a space, on the white the project page uses. One row per project — number, title, year — sharing a single grid between header and rows so the columns line up. Hovering the list dims every row but the one under the cursor. It lives at the `/index` route (a route, not state, so it survives a reload and the back button), and sits at `z-index: 100` under the frame. A row hands off to `/project/:id` with no pending transition, so the project page takes its plain-fade fallback; closing returns you to whichever view opened it.

**`src/splash/index.tsx`** — `SplashVideo`: the intro video over the canvas. The first wheel captures the current frame, which becomes `SplashPlane` in `scene.tsx`: a plane at cover size that scrolls in depth like the others. **It is seen once**, in two senses. Within a visit, the moment it would wrap round its depth cycle (faded out past the far end, or passed behind the camera) it retires: `onSplashGone` unmounts it and frees the texture, so it can never come back. Across visits, `localStorage["rh:splash-seen"]` is set once the video actually plays, and a returning visitor skips it entirely (so do deep links). To see it again, delete that key.

### Performance patterns

**`cameraGridRef`**: A `React.RefObject<CameraGridState>` shared with every `MediaPlane`. Updated each frame in `SceneController.useFrame`; planes read `scrollDelta`, `camX`, and `cumulativeScroll` without causing React re-renders.

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
