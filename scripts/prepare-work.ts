/**
 * prepare-work.ts — web copies of the Work images: everything the canvas, the
 * project pages and the index show.
 *
 *   npm run work:images -- "<client folder>" [--force]
 *
 * The client folder holds one folder per project, and the folder's name is the
 * project's title, used as-is. Inside, images sit in subfolders (PR-02_IMG,
 * PR-01_IMAGES) or loose; subfolders with VID in the name are videos and are
 * skipped. Projects and the images within them are ordered by name (natural
 * sort, so _2 comes before _10).
 *
 * Each image gets two copies, both to the shared spec in media.ts:
 *   public/work/<project>/<name>.jpg         longest side 3000px — project page, index
 *   public/work/<project>/canvas/<name>.jpg  longest side 1000px — canvas textures,
 *     since the canvas holds every image on the GPU at once
 *
 * Copies newer than their source are skipped unless --force is passed. The
 * client folder is the source of truth: anything in public/work/ it no longer
 * accounts for is deleted, so removing a project folder removes the project.
 * The manifest is rebuilt from scratch every run.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import sharp from "sharp";
import { byName, encode, isFresh, LONGEST_SIDE, mb, SOURCE_EXT } from "./media.ts";

const CANVAS_LONGEST_SIDE = 1000;

const ROOT = path.resolve(import.meta.dirname, "..");
const OUT_DIR = path.join(ROOT, "public", "work");
const MANIFEST_PATH = path.join(ROOT, "src", "work", "manifest.json");

const args = process.argv.slice(2);
const force = args.includes("--force");
const source = args.find((a) => !a.startsWith("--"));
if (!source) {
  console.error('Usage: npm run work:images -- "<client folder>" [--force]');
  process.exit(1);
}

const visible = (dir: string) => fs.readdirSync(dir, { withFileTypes: true }).filter((e) => !e.name.startsWith("."));

/** A project's images: loose files first, then each non-video subfolder, all by name. */
function imagesIn(projectDir: string) {
  const entries = visible(projectDir).sort((a, b) => byName(a.name, b.name));
  const dirs = [
    projectDir,
    ...entries.filter((e) => e.isDirectory() && !/VID/i.test(e.name)).map((e) => path.join(projectDir, e.name)),
  ];
  return dirs.flatMap((dir) =>
    visible(dir)
      .filter((e) => e.isFile() && SOURCE_EXT.test(e.name))
      .map((e) => e.name)
      .sort(byName)
      .map((name) => path.join(dir, name))
  );
}

type Entry = { url: string; canvasUrl: string; width: number; height: number; project: string };
const manifest: Entry[] = [];
const expected = new Set<string>();

const projects = visible(source)
  .filter((e) => e.isDirectory())
  .map((e) => e.name)
  .sort(byName);

for (const project of projects) {
  const images = imagesIn(path.join(source, project));
  console.log(`\n${project}: ${images.length} images`);
  fs.mkdirSync(path.join(OUT_DIR, project, "canvas"), { recursive: true });

  for (const src of images) {
    const name = `${path.parse(src).name}.jpg`;
    const full = path.join(OUT_DIR, project, name);
    const canvas = path.join(OUT_DIR, project, "canvas", name);
    expected.add(full).add(canvas);

    const started = performance.now();
    const fullFresh = !force && isFresh(src, full);
    if (!fullFresh) await encode(src, full, LONGEST_SIDE);
    if (force || !isFresh(src, canvas)) await encode(src, canvas, CANVAS_LONGEST_SIDE);

    // The full copy's dimensions stand for both; the aspect is what the site reads.
    const { width, height } = await sharp(full).metadata();
    manifest.push({
      url: `work/${project}/${name}`,
      canvasUrl: `work/${project}/canvas/${name}`,
      width,
      height,
      project,
    });

    const secs = ((performance.now() - started) / 1000).toFixed(1);
    const sizes = `${mb(fs.statSync(src).size)} → ${mb(fs.statSync(full).size)} + ${mb(fs.statSync(canvas).size)}`;
    console.log(`${fullFresh ? "skip" : "done"}  ${path.basename(src)}  ${width}×${height}  ${sizes}  ${secs}s`);
  }
}

// Prune: files the client folder no longer accounts for, then emptied folders.
function prune(dir: string) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      prune(p);
      if (fs.readdirSync(p).length === 0) fs.rmdirSync(p);
    } else if (!expected.has(p)) {
      fs.rmSync(p);
      console.log(`removed  ${path.relative(ROOT, p)}`);
    }
  }
}
prune(OUT_DIR);

fs.mkdirSync(path.dirname(MANIFEST_PATH), { recursive: true });
fs.writeFileSync(MANIFEST_PATH, `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`\nManifest: ${projects.length} projects, ${manifest.length} images → ${path.relative(ROOT, MANIFEST_PATH)}`);
