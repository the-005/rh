import * as THREE from "three";
import { whenImagesMayLoad } from "~/src/splash/hold";
import type { MediaItem } from "./types";

// Getting images to the GPU without stalling a frame (the owner, 7 Nov: the
// gallery stuttered on a phone). Each image is decoded off the main thread as
// soon as it arrives, then waits in `ready` until the frame loop sends it to
// the GPU (uploadTextures): a few per frame, for at most UPLOAD_BUDGET_MS, so
// several arriving together, as they do when scrolling fast, don't all land on
// one frame.
const UPLOAD_BUDGET_MS = 4;

// Phones draw each image at most this many pixels on its long side, from the
// same 1000px copy: on a phone no image in the gallery is ever shown above
// about 250px, and the full copies came to about 1 GB of GPU memory for the
// 245 images, which a phone can't hold comfortably. Tablets and computers keep
// the full copy.
const PHONE_TEXTURE_PX = 512;
const PHONE =
  (window.matchMedia?.("(pointer: coarse)").matches ?? false) && Math.min(window.screen.width, window.screen.height) < 600;

const textureCache = new Map<string, THREE.Texture>();
const loadCallbacks = new Map<string, Set<(tex: THREE.Texture) => void>>();
const loader = new THREE.ImageLoader();
const ready: { key: string; texture: THREE.Texture; image: HTMLImageElement }[] = [];

const isTextureLoaded = (tex: THREE.Texture) => tex.userData.uploaded === true;

// On a phone, the image redrawn at PHONE_TEXTURE_PX on its long side.
const forScreen = (image: HTMLImageElement): HTMLImageElement | HTMLCanvasElement => {
  const scale = PHONE_TEXTURE_PX / Math.max(image.naturalWidth, image.naturalHeight);
  if (!PHONE || scale >= 1) return image;
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(image.naturalWidth * scale);
  canvas.height = Math.round(image.naturalHeight * scale);
  const ctx = canvas.getContext("2d");
  if (!ctx) return image;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
  return canvas;
};

export const getTexture = (item: MediaItem, onLoad?: (texture: THREE.Texture) => void): THREE.Texture => {
  const key = item.canvasUrl;
  const existing = textureCache.get(key);

  if (existing) {
    if (onLoad) {
      if (isTextureLoaded(existing)) {
        onLoad(existing);
      } else {
        loadCallbacks.get(key)?.add(onLoad);
      }
    }
    return existing;
  }

  const callbacks = new Set<(tex: THREE.Texture) => void>();
  if (onLoad) callbacks.add(onLoad);
  loadCallbacks.set(key, callbacks);

  // Manifest URLs are relative — resolve from the site root, not the current
  // route, or every texture 404s when the app is entered via /project/x.
  const src = key.startsWith("/") || key.includes("://") ? key : `/${key}`;

  // The texture exists at once; its image arrives later, as with TextureLoader.
  // Under the intro splash the download waits for the video (src/splash/hold.ts).
  const texture = new THREE.Texture();
  whenImagesMayLoad(() =>
    loader.load(
      src,
      (image) => {
        // Decoded now, off the main thread, so sending it to the GPU later
        // doesn't decode it in the middle of a frame.
        image
          .decode()
          .catch(() => {})
          .then(() => ready.push({ key, texture, image }));
      },
      undefined,
      (err) => console.error("Texture load failed:", key, err)
    )
  );

  textureCache.set(key, texture);
  return texture;
};

/** Once a frame, from the frame loop: send the images that have arrived to the
 *  GPU, at least one and then as many as fit in UPLOAD_BUDGET_MS, and tell the
 *  planes waiting on them. */
export function uploadTextures(renderer: THREE.WebGLRenderer) {
  const start = performance.now();
  for (let first = true; ready.length && (first || performance.now() - start < UPLOAD_BUDGET_MS); first = false) {
    const { key, texture, image } = ready.shift() as (typeof ready)[number];
    texture.image = forScreen(image);
    texture.minFilter = THREE.LinearMipmapLinearFilter;
    texture.magFilter = THREE.LinearFilter;
    texture.generateMipmaps = true;
    texture.anisotropy = 4;
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.needsUpdate = true;
    renderer.initTexture(texture);
    texture.userData.uploaded = true;

    loadCallbacks.get(key)?.forEach((cb) => {
      try {
        cb(texture);
      } catch (err) {
        console.error(`Callback failed: ${JSON.stringify(err)}`);
      }
    });
    loadCallbacks.delete(key);
  }
}
