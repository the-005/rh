import * as THREE from "three";
import { whenImagesMayLoad } from "~/src/splash/hold";
import type { MediaItem } from "./types";

const textureCache = new Map<string, THREE.Texture>();
const loadCallbacks = new Map<string, Set<(tex: THREE.Texture) => void>>();
const loader = new THREE.ImageLoader();

const isTextureLoaded = (tex: THREE.Texture): boolean => {
  const img = tex.image as HTMLImageElement | undefined;
  return img instanceof HTMLImageElement && img.complete && img.naturalWidth > 0;
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
        texture.image = image;
        texture.minFilter = THREE.LinearMipmapLinearFilter;
        texture.magFilter = THREE.LinearFilter;
        texture.generateMipmaps = true;
        texture.anisotropy = 4;
        texture.colorSpace = THREE.SRGBColorSpace;
        texture.needsUpdate = true;

        loadCallbacks.get(key)?.forEach((cb) => {
          try {
            cb(texture);
          } catch (err) {
            console.error(`Callback failed: ${JSON.stringify(err)}`);
          }
        });
        loadCallbacks.delete(key);
      },
      undefined,
      (err) => console.error("Texture load failed:", key, err)
    )
  );

  textureCache.set(key, texture);
  return texture;
};
