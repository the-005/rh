import type { MediaItem } from "~/src/infinite-canvas/types";
import allManifest from "~/src/work/manifest.json";

const ALL_MEDIA = allManifest as MediaItem[];

export interface ProjectEntry {
  /** The client's folder name — the `project` field in the manifest and the /project/:id route. */
  id: string;
  /** The folder name as-is: renaming the folder retitles the project. */
  title: string;
  year: string;
  /** How many images the project holds — handy for an index that wants a count. */
  count: number;
  /** First image in manifest order; the natural thumbnail if the index grows one. */
  cover: string;
  /** Every image in manifest order. The index scrubs along these. */
  images: string[];
}

/**
 * The title is the client's folder name. The manifest carries no dates, so the
 * year is read from filenames when one holds it; real years go here, keyed by
 * folder name, and anything absent keeps the derived value.
 */
const YEARS: Record<string, string> = {};

/** A four-digit year anywhere in the path, if the client's filenames carry one. */
function yearFromUrl(url: string): string {
  return url.match(/(?:19|20)\d{2}/)?.[0] ?? "—";
}

/** Projects in manifest order, one entry per distinct `project` slug. */
export const PROJECTS: ProjectEntry[] = (() => {
  const byId = new Map<string, MediaItem[]>();
  for (const item of ALL_MEDIA) {
    if (!item.project) continue;
    const bucket = byId.get(item.project);
    if (bucket) bucket.push(item);
    else byId.set(item.project, [item]);
  }

  return [...byId].map(([id, items]) => ({
    id,
    title: id,
    year: YEARS[id] ?? yearFromUrl(items[0].url),
    count: items.length,
    cover: items[0].url,
    images: items.map((item) => item.url),
  }));
})();
