/**
 * prepare-research.ts — web copies of the Research page images.
 *
 *   npm run research:images -- "<source folder>" [--force]
 *
 * The spec is the Squoosh one used by hand, so a scripted batch matches a
 * manual one: MozJPEG at quality 85, longest side 3000px, never enlarged. As
 * Squoosh does, each copy is turned upright, converted to sRGB and stripped of
 * metadata. Originals are only read.
 *
 * Copies land in public/research/ under their own names. A copy that already
 * exists is skipped unless its source has changed since, or --force is passed.
 * The manifest is then rebuilt from everything in public/research/, ordered by
 * the number in the filename (natural sort, so _2 comes before _10).
 */

import * as fs from "node:fs";
import * as path from "node:path";
import sharp from "sharp";

const ROOT = path.resolve(import.meta.dirname, "..");
const OUT_DIR = path.join(ROOT, "public", "research");
const MANIFEST_PATH = path.join(ROOT, "src", "research", "manifest.json");

const LONGEST_SIDE = 3000;
const QUALITY = 85;
const SOURCE_EXT = /\.(jpe?g|png|tiff?|webp)$/i;

const args = process.argv.slice(2);
const force = args.includes("--force");
const source = args.find((a) => !a.startsWith("--"));
if (!source) {
  console.error('Usage: npm run research:images -- "<source folder>" [--force]');
  process.exit(1);
}

const byName = (a: string, b: string) => a.localeCompare(b, undefined, { numeric: true });
const mb = (bytes: number) => `${(bytes / 1024 / 1024).toFixed(1)}MB`;

fs.mkdirSync(OUT_DIR, { recursive: true });

const files = fs
  .readdirSync(source)
  .filter((f) => SOURCE_EXT.test(f))
  .sort(byName);

for (const file of files) {
  const src = path.join(source, file);
  const out = path.join(OUT_DIR, `${path.parse(file).name}.jpg`);
  const srcStat = fs.statSync(src);
  if (!force && fs.existsSync(out) && fs.statSync(out).mtimeMs >= srcStat.mtimeMs) {
    console.log(`skip  ${file}`);
    continue;
  }

  const started = performance.now();
  // Some sources run past 500 megapixels, well over sharp's default input cap.
  const info = await sharp(src, { limitInputPixels: false })
    .autoOrient()
    .resize({
      width: LONGEST_SIDE,
      height: LONGEST_SIDE,
      fit: "inside",
      withoutEnlargement: true,
      // Squoosh decodes at full size before resizing; don't trade detail for speed.
      fastShrinkOnLoad: false,
    })
    .jpeg({ quality: QUALITY, mozjpeg: true, progressive: true })
    .toFile(out);
  const secs = ((performance.now() - started) / 1000).toFixed(1);
  console.log(`done  ${file}  ${info.width}×${info.height}  ${mb(srcStat.size)} → ${mb(info.size)}  ${secs}s`);
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
