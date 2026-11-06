/**
 * While the intro splash is up, the gallery under it holds back, so the video
 * has the connection to itself: the gallery's images don't start downloading
 * until the video plays (or the splash gives up), and its video previews don't
 * start until the splash is out of the way, since nobody sees them under it.
 *
 * Read from index.html's class, like the app's SKIP_SPLASH: with no splash
 * nothing is ever held.
 */

let imagesHeld = document.documentElement.classList.contains("splash");
let previewsHeld = imagesHeld;
const waiting: (() => void)[] = [];

/** Starts a gallery image's download now, or once the splash lets it. */
export function whenImagesMayLoad(start: () => void) {
  if (imagesHeld) waiting.push(start);
  else start();
}

/** The video plays, or the splash gave up: the gallery's images may load. */
export function releaseImages() {
  imagesHeld = false;
  for (const start of waiting.splice(0)) start();
}

/** The splash is out of the way: everything may load, previews included. */
export function releaseAll() {
  previewsHeld = false;
  releaseImages();
}

/** Whether the gallery's video previews may play. */
export const previewsMayPlay = () => !previewsHeld;
