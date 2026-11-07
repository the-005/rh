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

type Source = HTMLImageElement | HTMLCanvasElement | ImageBitmap;

const textureCache = new Map<string, THREE.Texture>();
const loadCallbacks = new Map<string, Set<(tex: THREE.Texture) => void>>();
const loader = new THREE.ImageLoader();
const ready: { key: string; texture: THREE.Texture; image: Source; bitmap?: boolean }[] = [];

const isTextureLoaded = (tex: THREE.Texture) => tex.userData.uploaded === true;

// The size a phone draws an image at: PHONE_TEXTURE_PX on its long side, never enlarged.
const phoneSize = (item: MediaItem) => {
  const long = Math.max(item.width, item.height);
  const scale = Math.min(PHONE_TEXTURE_PX, long) / long;
  return { width: Math.max(1, Math.round(item.width * scale)), height: Math.max(1, Math.round(item.height * scale)) };
};

// On a phone, the file is decoded straight to that size off the main thread
// (createImageBitmap from the downloaded file) and sent to the GPU as it is.
// Shrinking it in a canvas from the loaded image, as it was, decoded it again
// on the main thread inside a frame, ~7ms each with the CPU slowed to a
// phone's, and copying a bitmap into a canvas cost ~9ms more: the dropped
// frames in the flight into a project (the owner, 7 Nov: "a slight
// jitteriness during the movement from gallery to project"). A bitmap goes up
// as stored, top row first, whatever flipY says (browsers differ on that), so
// it's uploaded unflipped and turned the right way up by the texture's own
// coordinates (uploadTextures). Checked in Chrome and WebKit (Safari 26.4):
// the size asked for, the right way up.
const loadSmall = async (src: string, item: MediaItem): Promise<ImageBitmap> => {
  const response = await fetch(src);
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const { width, height } = phoneSize(item);
  return createImageBitmap(await response.blob(), {
    resizeWidth: width,
    resizeHeight: height,
    resizeQuality: "high",
    colorSpaceConversion: "none",
  });
};

// Where createImageBitmap is missing (iPhones before iOS 15): the image
// shrunk in a canvas as it arrives, on the main thread but outside a frame.
const shrink = (image: HTMLImageElement, item: MediaItem): Source => {
  const { width, height } = phoneSize(item);
  if (width >= image.naturalWidth) return image;
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) return image;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(image, 0, 0, width, height);
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
  whenImagesMayLoad(() => {
    if (PHONE && typeof createImageBitmap === "function") {
      loadSmall(src, item)
        .then((image) => ready.push({ key, texture, image, bitmap: true }))
        .catch((err) => console.error("Texture load failed:", key, err));
      return;
    }
    loader.load(
      src,
      (image) => {
        // Decoded now, off the main thread, so sending it to the GPU later
        // doesn't decode it in the middle of a frame.
        image
          .decode()
          .catch(() => {})
          .then(() => ready.push({ key, texture, image: PHONE ? shrink(image, item) : image }));
      },
      undefined,
      (err) => console.error("Texture load failed:", key, err)
    );
  });

  textureCache.set(key, texture);
  return texture;
};

/** Once a frame, from the frame loop: send the images that have arrived to the
 *  GPU, at least one and then as many as fit in UPLOAD_BUDGET_MS, and tell the
 *  planes waiting on them. */
export function uploadTextures(renderer: THREE.WebGLRenderer) {
  const start = performance.now();
  for (let first = true; ready.length && (first || performance.now() - start < UPLOAD_BUDGET_MS); first = false) {
    const { key, texture, image, bitmap } = ready.shift() as (typeof ready)[number];
    texture.image = image;
    if (bitmap) {
      // Uploaded top row first (loadSmall), so read bottom to top.
      texture.flipY = false;
      texture.repeat.set(1, -1);
      texture.offset.set(0, 1);
    }
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
