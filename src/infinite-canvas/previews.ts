/**
 * Video previews in the gallery: a video's plane plays its looping preview
 * (the pieces cut in the admin's preview cutter, up to 10 s) instead of its
 * still, as decided with Ruben on 4 Oct ("in the gallery each video shows a
 * short loop, and the full version loads on click").
 *
 * Every frame, each visible plane that has a preview asks for it with a
 * priority (how visible and how close it is). Only the MAX_PLAYING most wanted
 * previews play, one <video> per preview however many planes show it; the
 * rest pause, and a preview nobody has wanted for a while lets its video go.
 * A plane shows the preview only once it's actually playing, so the still
 * never gives way to a blank or frozen frame.
 */

import * as THREE from "three";

const MAX_PLAYING = 4;
// A preview not wanted for this long frees its video.
const RELEASE_MS = 8000;
// With no frames for this long (the canvas paused under a page), all pause.
const STALL_MS = 600;

type Entry = { video: HTMLVideoElement; texture: THREE.VideoTexture; playing: boolean; wanted: number };

const entries = new Map<string, Entry>();
let requests = new Map<string, number>();
// Planes drawing a preview this frame and last, for the diagnostic below.
let shownNow = 0;
let shownLast = 0;
let lastFrame = 0;
let watchdog = 0;

/** A plane wants its preview this frame, with how much it matters. */
export function wantPreview(url: string, priority: number) {
  requests.set(url, Math.max(priority, requests.get(url) ?? 0));
}

/** The preview's texture, once its video is playing; otherwise null. A
 *  plane that gets one is counted as showing it. */
export function previewTexture(url: string): THREE.Texture | null {
  const entry = entries.get(url);
  if (!entry?.playing) return null;
  shownNow++;
  return entry.texture;
}

// A read-only look at what's playing, for checking the gallery from the
// browser console (`rhPreviews()`): which previews have a video, whether it's
// playing and where, and how many planes drew one last frame.
(window as unknown as { rhPreviews: () => unknown }).rhPreviews = () => ({
  planes: shownLast,
  videos: [...entries].map(([url, e]) => ({ url, playing: e.playing, time: Number(e.video.currentTime.toFixed(2)) })),
});

function create(url: string): Entry {
  const video = document.createElement("video");
  video.muted = true;
  video.loop = true;
  video.playsInline = true;
  video.preload = "auto";
  video.src = url.startsWith("/") ? url : `/${url}`;
  const texture = new THREE.VideoTexture(video);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.generateMipmaps = false;
  const entry: Entry = { video, texture, playing: false, wanted: 0 };
  video.addEventListener("playing", () => {
    entry.playing = true;
  });
  video.addEventListener("pause", () => {
    entry.playing = false;
  });
  entries.set(url, entry);
  if (!watchdog) {
    watchdog = window.setInterval(() => {
      if (performance.now() - lastFrame > STALL_MS) for (const e of entries.values()) e.video.pause();
    }, 300);
  }
  return entry;
}

function release(url: string, entry: Entry) {
  entry.video.pause();
  entry.video.removeAttribute("src");
  entry.video.load();
  entry.texture.dispose();
  entries.delete(url);
}

/** Once a frame, before the planes: play the most wanted, pause the rest. */
export function decidePreviews(now: number) {
  lastFrame = now;
  shownLast = shownNow;
  shownNow = 0;
  const chosen = new Set(
    [...requests]
      .sort((a, b) => b[1] - a[1])
      .slice(0, MAX_PLAYING)
      .map(([url]) => url)
  );
  requests = new Map();
  for (const url of chosen) {
    const entry = entries.get(url) ?? create(url);
    entry.wanted = now;
    if (entry.video.paused) entry.video.play().catch(() => {});
  }
  for (const [url, entry] of entries) {
    if (chosen.has(url)) continue;
    if (!entry.video.paused) entry.video.pause();
    if (now - entry.wanted > RELEASE_MS) release(url, entry);
  }
}
