/**
 * media.ts — the image spec shared by the Work and Research scripts.
 *
 * It is the Squoosh process used by hand, so a scripted batch matches a manual
 * one: MozJPEG at quality 85, never enlarged, and — as Squoosh does — turned
 * upright, converted to sRGB and stripped of metadata. Originals are only read.
 */

import * as fs from "node:fs";
import sharp from "sharp";

/** The full-size copy: every page that shows an image as an image. */
export const LONGEST_SIDE = 3000;
export const QUALITY = 85;
export const SOURCE_EXT = /\.(jpe?g|png|tiff?|webp)$/i;

/** Natural order, so _2 comes before _10. */
export const byName = (a: string, b: string) => a.localeCompare(b, undefined, { numeric: true });

export const mb = (bytes: number) => `${(bytes / 1024 / 1024).toFixed(1)}MB`;

/** A copy is current when it exists and is newer than its source. */
export function isFresh(src: string, out: string) {
  return fs.existsSync(out) && fs.statSync(out).mtimeMs >= fs.statSync(src).mtimeMs;
}

export async function encode(src: string, out: string, longestSide: number) {
  // Some sources run past 500 megapixels, well over sharp's default input cap.
  return sharp(src, { limitInputPixels: false })
    .autoOrient()
    .resize({
      width: longestSide,
      height: longestSide,
      fit: "inside",
      withoutEnlargement: true,
      // Squoosh decodes at full size before resizing; don't trade detail for speed.
      fastShrinkOnLoad: false,
    })
    .jpeg({ quality: QUALITY, mozjpeg: true, progressive: true })
    .toFile(out);
}
