/**
 * What the site shows, read from storage as it loads (/api/site, built by the
 * admin: admin/site-data.ts). Every module that lists projects or media reads
 * MEDIA and INFO from here instead of the files built into the site, so what's
 * saved in the admin shows without a rebuild.
 *
 * src/index.tsx waits for loadSiteData() before it imports the app, so these
 * are settled before anything reads them. When storage can't be read (`npm run
 * dev` has no Worker, or it's slow or down), the site falls back to its own
 * manifest and info.json, which hold the 11 projects as they were.
 */

import type { MediaItem } from "~/src/infinite-canvas/types";
import type { ProjectInfo } from "~/src/projects/info";
import builtInInfo from "~/src/projects/info.json";
import builtInMedia from "./manifest.json";

export let MEDIA: MediaItem[] = builtInMedia as MediaItem[];
export let INFO: Record<string, ProjectInfo> = builtInInfo;

// Long enough for storage on the far side of the world; short enough that the
// site still opens if the Worker is down.
const WAIT_MS = 4000;

export async function loadSiteData() {
  const abort = new AbortController();
  const timer = window.setTimeout(() => abort.abort(), WAIT_MS);
  try {
    const response = await fetch("/api/site", { signal: abort.signal });
    if (!response.ok) return;
    const data = (await response.json()) as { media?: MediaItem[]; info?: Record<string, ProjectInfo> };
    if (Array.isArray(data.media) && data.media.length) {
      MEDIA = data.media;
      INFO = data.info ?? {};
    }
  } catch {
    // The built-in projects stand.
  } finally {
    window.clearTimeout(timer);
  }
}
