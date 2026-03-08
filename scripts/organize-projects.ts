/**
 * organize-projects.ts
 *
 * Run once: npx tsx scripts/organize-projects.ts
 *
 * - Reads filenames from IMAGES/ART/ and IMAGES/COMMERCE/
 * - Shuffles each list, splits into groups of 10
 * - Moves files into subdirectories: IMAGES/ART/art-1/, public/images/art/art-1/, etc.
 * - Regenerates src/images/manifest.json with updated URL paths and a `project` field
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, "..");

const IMAGES_ART_SRC = path.join(ROOT, "IMAGES", "ART");
const IMAGES_COMMERCE_SRC = path.join(ROOT, "IMAGES", "COMMERCE");
const PUBLIC_ART = path.join(ROOT, "public", "images", "art");
const PUBLIC_COMMERCE = path.join(ROOT, "public", "images", "commerce");
const MANIFEST_PATH = path.join(ROOT, "src", "images", "manifest.json");

const GROUP_SIZE = 10;

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j]!, a[i]!];
  }
  return a;
}

function splitIntoGroups<T>(arr: T[], size: number): T[][] {
  const groups: T[][] = [];
  for (let i = 0; i < arr.length; i += size) {
    groups.push(arr.slice(i, i + size));
  }
  return groups;
}

function moveFiles(files: string[], srcDir: string, destDir: string): void {
  fs.mkdirSync(destDir, { recursive: true });
  for (const file of files) {
    const src = path.join(srcDir, file);
    const dest = path.join(destDir, file);
    if (fs.existsSync(src)) {
      fs.renameSync(src, dest);
    } else {
      console.warn(`  [warn] File not found: ${src}`);
    }
  }
}

// Read existing manifest to extract dimensions keyed by filename
type ExistingEntry = { url: string; width: number; height: number; category: string; project?: string };
const existingManifest: ExistingEntry[] = JSON.parse(fs.readFileSync(MANIFEST_PATH, "utf8"));
const dimsByFilename = new Map<string, { width: number; height: number }>();
for (const entry of existingManifest) {
  const filename = path.basename(entry.url);
  dimsByFilename.set(filename, { width: entry.width, height: entry.height });
}

// Get flat file lists (skip any that are directories = already organized)
function getFlatFiles(dir: string): string[] {
  return fs
    .readdirSync(dir)
    .filter((f) => {
      const fullPath = path.join(dir, f);
      return fs.statSync(fullPath).isFile() && /\.(jpg|jpeg|png|webp|gif)$/i.test(f);
    })
    .sort();
}

// Process a category
function processCategory(
  category: "art" | "commerce",
  imagesSourceDir: string,
  publicDir: string,
  prefix: string,
): ExistingEntry[] {
  const files = getFlatFiles(imagesSourceDir);
  console.log(`\n${category.toUpperCase()}: ${files.length} files`);

  const shuffled = shuffle(files);
  const groups = splitIntoGroups(shuffled, GROUP_SIZE);

  const entries: ExistingEntry[] = [];

  for (let i = 0; i < groups.length; i++) {
    const groupName = `${prefix}-${i + 1}`;
    const groupFiles = groups[i]!;

    console.log(`  ${groupName}: ${groupFiles.length} files`);

    // Move from IMAGES source
    const srcSubDir = path.join(imagesSourceDir, groupName);
    moveFiles(groupFiles, imagesSourceDir, srcSubDir);

    // Move from public/images
    const pubSubDir = path.join(publicDir, groupName);
    moveFiles(groupFiles, publicDir, pubSubDir);

    // Build manifest entries
    for (const file of groupFiles) {
      const dims = dimsByFilename.get(file) ?? { width: 800, height: 1000 };
      entries.push({
        url: `images/${category}/${groupName}/${file}`,
        width: dims.width,
        height: dims.height,
        category,
        project: groupName,
      });
    }
  }

  return entries;
}

console.log("Organizing projects...");

const artEntries = processCategory("art", IMAGES_ART_SRC, PUBLIC_ART, "art");
const commerceEntries = processCategory("commerce", IMAGES_COMMERCE_SRC, PUBLIC_COMMERCE, "commerce");

const newManifest = [...artEntries, ...commerceEntries];
fs.writeFileSync(MANIFEST_PATH, JSON.stringify(newManifest, null, 2) + "\n");

console.log(`\nManifest written: ${newManifest.length} entries`);
console.log("Done.");
