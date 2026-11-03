/**
 * site-data.ts — what the public site shows, built from storage: every
 * project switched on in the admin ("Show on the site"), in the admin's order,
 * with its images (and videos) in order and what it says about itself.
 *
 * Written to storage as site.json whenever something that changes it happens
 * (a save or a new order in the admin, a finished item in the processing), so
 * the site reads one small file when it loads (/api/site, worker/site.ts).
 *
 * The 11 projects brought in from the site keep pointing at the site's own
 * files (public/work/, served from Cloudflare's network as before), so they
 * load exactly as fast as they did. Everything uploaded through the admin comes
 * from storage, through the site's /media/ route.
 */

import { type Copies, keys, previewStatusId, type Project, type Status, shownOnSite } from "./shared.ts";

// One picture on the site: the shape src/infinite-canvas/types.ts calls a
// MediaItem. A video is its first frame as a picture (for the gallery, the
// index and the strip's resting state), plus the video itself and, once one
// is made, its looping preview.
export type SiteMedia = {
  url: string;
  midUrl: string;
  canvasUrl: string;
  width: number;
  height: number;
  project: string;
  type?: "video";
  video?: string;
  preview?: string;
};

export type SiteInfo = { name?: string; kind?: string; year?: string; credits?: { role: string; name: string }[] };

export type SiteData = { media: SiteMedia[]; info: Record<string, SiteInfo>; built: string };

export const SITE_KEY = "site.json";

const media = (key: string) => `media/${key}`;

async function read<T>(bucket: R2Bucket, key: string): Promise<T | null> {
  const object = await bucket.get(key);
  return object ? ((await object.json()) as T) : null;
}

export async function buildSite(bucket: R2Bucket): Promise<SiteData> {
  const order = (await read<{ order: string[] }>(bucket, keys.index))?.order ?? [];
  const loaded = await Promise.all(
    order.map(async (id) => {
      const [project, status] = await Promise.all([
        read<Project>(bucket, keys.project(id)),
        read<Status>(bucket, keys.status(id)),
      ]);
      return { id, project, status: status ?? {} };
    })
  );
  const out: SiteMedia[] = [];
  const info: Record<string, SiteInfo> = {};
  for (const { id, project, status } of loaded) {
    if (!project || !shownOnSite(project)) continue;
    for (const item of project.items) {
      const state = status[item.id];
      if (item.type === "image") {
        if (item.copies) {
          // The site's own copy of a project brought in from it.
          out.push({
            url: `work/${id}/${item.file}`,
            midUrl: `work/${id}/1500/${item.file}`,
            canvasUrl: `work/${id}/canvas/${item.file}`,
            width: item.width ?? 0,
            height: item.height ?? 0,
            project: id,
          });
          continue;
        }
        const copies: Copies | undefined = state?.copies;
        if (state?.state !== "done" || !copies) continue;
        out.push({
          url: media(copies.full),
          midUrl: media(copies.mid),
          canvasUrl: media(copies.canvas),
          width: state.width ?? 0,
          height: state.height ?? 0,
          project: id,
        });
      } else {
        // A video shows once it's compressed and has its first frame as a picture.
        if (state?.state !== "done" || !state.video || !state.copies) continue;
        const preview = status[previewStatusId(item.id)];
        out.push({
          url: media(state.copies.full),
          midUrl: media(state.copies.mid),
          canvasUrl: media(state.copies.canvas),
          width: state.width ?? 0,
          height: state.height ?? 0,
          project: id,
          type: "video",
          video: media(state.video),
          ...(preview?.state === "done" && preview.video ? { preview: media(preview.video) } : {}),
        });
      }
    }
    // Only what a project really says about itself: one with nothing yet keeps
    // the site's placeholders (src/projects).
    const real = project.name !== id || project.kind || project.year || project.credits.length;
    if (real) info[id] = { name: project.name, kind: project.kind, year: project.year, credits: project.credits };
  }
  return { media: out, info, built: new Date().toISOString() };
}

export async function publishSite(bucket: R2Bucket) {
  const site = await buildSite(bucket);
  await bucket.put(SITE_KEY, JSON.stringify(site), { httpMetadata: { contentType: "application/json" } });
  return site;
}
