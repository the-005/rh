# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

A photography portfolio website built as a 3D infinite pannable space — bootstrapped from [edoardolunardi/infinite-canvas](https://github.com/edoardolunardi/infinite-canvas). Uses React 19, Three.js, React Three Fiber, TypeScript, and Vite.

## Git workflow

After every meaningful change: stage specific files, commit with a clear message, and push to `origin main`. This keeps GitHub as the always-current backup.

```bash
git add <files>
git commit -m "concise description of what and why"
git push origin main
```

Repository: `https://github.com/the-005/rh`

## Commands

Node 22 is required (see `.nvmrc`). Node is installed via Homebrew at `/opt/homebrew/opt/node@22/bin/` — prefix commands with `export PATH="/opt/homebrew/opt/node@22/bin:$PATH" &&` if `npm` is not in PATH.

```bash
npm run dev          # start dev server (network accessible)
npm run build        # TypeScript compile + Vite bundle
npm run check        # type check + lint (run before committing)
npm run check:types  # TypeScript only
npm run check:biome  # Biome lint only
npm run format       # auto-format with Biome
```

Linting/formatting is handled by **Biome** (not ESLint/Prettier). Config is in `biome.jsonc`.

## Architecture

### Data flow
`src/artworks/manifest.json` → `App` → `InfiniteCanvas` → Three.js scene

Media items are plain objects `{ url, width, height }`. To swap in your own photos, replace `public/artworks/` images and regenerate `src/artworks/manifest.json` (the script `scripts/download-artworks.ts` shows the manifest shape).

### Key modules

**`src/infinite-canvas/`** — the core 3D engine (do not restructure lightly):
- `scene.tsx` — three main components: `SceneController` (camera/input), `Chunk` (a cubic spatial cell), `MediaPlane` (a single image rendered as a 3D plane with fade-in)
- `constants.ts` — all tunable physics/render values (`CHUNK_SIZE`, `RENDER_DISTANCE`, `MAX_VELOCITY`, etc.)
- `texture-manager.ts` — texture loading/caching; reports progress via `onTextureProgress`
- `types.ts` — shared types: `MediaItem`, `InfiniteCanvasProps`, `ChunkData`, `PlaneData`
- `utils.ts` / `src/utils.ts` — small helpers

**`src/app/index.tsx`** — root `App` component; wires manifest → `InfiniteCanvas` + `PageLoader` + `Frame`

**`src/frame/index.tsx`** — the HTML overlay header (title, nav links). This is where portfolio branding goes.

**`src/loader/index.tsx`** — loading progress overlay, driven by texture-load progress (0–1).

### Chunked streaming
The 3D space is divided into cubic chunks (`CHUNK_SIZE = 110` units). `SceneController` tracks camera position in chunk coordinates and mounts/unmounts `Chunk` components within `RENDER_DISTANCE` chunks of the camera. Each `Chunk` uses `requestIdleCallback` to generate plane positions, then `MediaPlane` fades them in. Planes beyond `DEPTH_FADE_START`/`DEPTH_FADE_END` fade out.

### Controls
Mouse drag / touch pan → camera drift with momentum (`VELOCITY_DECAY = 0.9`). Scroll / pinch → zoom. WASD + QE keyboard movement. All physics constants live in `constants.ts`.

### Path aliases
`~/src/...` resolves to `src/` (configured in `vite.config.ts` and `tsconfig.app.json`).
