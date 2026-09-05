import allManifest from "~/src/images/manifest.json";
import type { MediaItem } from "~/src/infinite-canvas/types";

const ALL_MEDIA = allManifest as MediaItem[];

export interface ProjectEntry {
  /** Slug used by the /project/:id route and the `project` field in the manifest. */
  id: string;
  title: string;
  year: string;
  category: string;
  /** How many images the project holds — handy for an index that wants a count. */
  count: number;
  /** First image in manifest order; the natural thumbnail if the index grows one. */
  cover: string;
}

/**
 * The manifest carries no titles and no dates, so everything below is derived
 * from the slug and the filenames. Real names and years go here, keyed by slug —
 * one entry overrides one field, anything absent keeps the derived value.
 */
const OVERRIDES: Record<string, Partial<Pick<ProjectEntry, "title" | "year">>> = {};

/** "art-11" → "Art 11" — a legible stand-in until the real titles land. */
function titleFromId(id: string): string {
  return id
    .split("-")
    .map((part) => (/^\d+$/.test(part) ? part.padStart(2, "0") : part.charAt(0).toUpperCase() + part.slice(1)))
    .join(" ");
}

/** Filenames look like RH_ART2025_061.jpg — the only date the manifest carries. */
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
    title: OVERRIDES[id]?.title ?? titleFromId(id),
    year: OVERRIDES[id]?.year ?? yearFromUrl(items[0].url),
    category: items[0].category ?? "",
    count: items.length,
    cover: items[0].url,
  }));
})();
