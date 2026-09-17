/**
 * prepare-research.ts — web copies of the Research page images.
 *
 *   npm run research:images -- "<source folder>" [--force]
 *
 * Encodes to the shared spec in media.ts (MozJPEG q85, longest side 3000px).
 * Copies land in public/research/ under their own names. A copy that already
 * exists is skipped unless its source has changed since, or --force is passed.
 * The manifest is then rebuilt from everything in public/research/, ordered by
 * the number in the filename.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import sharp from "sharp";
import { byName, encode, isFresh, LONGEST_SIDE, mb, SOURCE_EXT } from "./media.ts";

const ROOT = path.resolve(import.meta.dirname, "..");
const OUT_DIR = path.join(ROOT, "public", "research");
const MANIFEST_PATH = path.join(ROOT, "src", "research", "manifest.json");

const args = process.argv.slice(2);
const force = args.includes("--force");
const source = args.find((a) => !a.startsWith("--"));
if (!source) {
  console.error('Usage: npm run research:images -- "<source folder>" [--force]');
  process.exit(1);
}

fs.mkdirSync(OUT_DIR, { recursive: true });

const files = fs
  .readdirSync(source)
  .filter((f) => SOURCE_EXT.test(f))
  .sort(byName);

for (const file of files) {
  const src = path.join(source, file);
  const out = path.join(OUT_DIR, `${path.parse(file).name}.jpg`);
  if (!force && isFresh(src, out)) {
    console.log(`skip  ${file}`);
    continue;
  }

  const started = performance.now();
  const info = await encode(src, out, LONGEST_SIDE);
  const secs = ((performance.now() - started) / 1000).toFixed(1);
  console.log(`done  ${file}  ${info.width}×${info.height}  ${mb(fs.statSync(src).size)} → ${mb(info.size)}  ${secs}s`);
}

const manifest: { url: string; width: number; height: number }[] = [];
for (const file of fs
  .readdirSync(OUT_DIR)
  .filter((f) => f.endsWith(".jpg"))
  .sort(byName)) {
  const { width, height } = await sharp(path.join(OUT_DIR, file)).metadata();
  manifest.push({ url: `research/${file}`, width, height });
}
fs.mkdirSync(path.dirname(MANIFEST_PATH), { recursive: true });
fs.writeFileSync(MANIFEST_PATH, `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`\nManifest: ${manifest.length} images → ${path.relative(ROOT, MANIFEST_PATH)}`);
