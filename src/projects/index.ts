import type { MediaItem } from "~/src/infinite-canvas/types";
import allManifest from "~/src/work/manifest.json";
import projectInfo from "./info.json";

const ALL_MEDIA = allManifest as MediaItem[];

/** One credit: who, and what they did. The role may be empty. */
export type Credit = { role: string; name: string };

export interface ProjectEntry {
  /** The client's folder name — the `project` field in the manifest and the /project/:id route. */
  id: string;
  /** The project's name from `info.json`, or the folder name as-is until it has one. */
  title: string;
  /** What kind of work it is ("Editorial"), or empty. */
  kind: string;
  /** A year or a season, as written in `info.json`; read from filenames, or "—", until then. */
  year: string;
  /** Who worked on it, in order; empty until it has credits. */
  credits: Credit[];
  /** How many images the project holds — handy for an index that wants a count. */
  count: number;
  /** First image in manifest order; the natural thumbnail if the index grows one. */
  cover: string;
  /** Every image in manifest order. The index scrubs along these. */
  images: string[];
}

/**
 * What each project says about itself, keyed by folder name: its name, kind,
 * year or season, and credits (the format agreed on 26 Oct). One place for
 * every page that shows them. A project missing here gets PLACEHOLDER in their
 * place, so every row shows the full format until its real details arrive.
 *
 * A credit is `{ "role": "Photography", "name": "Cassandra Troost" }`, or just
 * the name as a string while its role isn't known.
 */
type ProjectInfo = { name?: string; kind?: string; year?: string; credits?: (string | { role?: string; name: string })[] };
const INFO: Record<string, ProjectInfo> = projectInfo;

/**
 * Stand-ins for a project with no entry in `info.json` yet. The credits run
 * from two to six names down the list, so some rows show all of theirs and
 * some a "+N", under generic roles of different lengths.
 */
const PLACEHOLDER_ROLES = ["Photography", "Styling", "Hair", "Make-up", "Set design", "Production"];
function placeholder(order: number): Required<ProjectInfo> {
  return {
    name: "Project name",
    kind: "Kind",
    year: "Year",
    credits: Array.from({ length: 2 + ((order * 3) % 5) }, (_, i) => ({ role: PLACEHOLDER_ROLES[i], name: "Name Surname" })),
  };
}

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

  return [...byId].map(([id, items], order) => {
    const info = INFO[id] ?? placeholder(order);
    return {
      id,
      title: info.name ?? id,
      kind: info.kind ?? "",
      year: info.year ?? yearFromUrl(items[0].url),
      credits: (info.credits ?? []).map((credit) =>
        typeof credit === "string" ? { role: "", name: credit } : { role: credit.role ?? "", name: credit.name }
      ),
      count: items.length,
      cover: items[0].url,
      images: items.map((item) => item.url),
    };
  });
})();

/** Width ÷ height of every Work image, by url, for anything sized by its shape. */
export const ASPECTS: ReadonlyMap<string, number> = new Map(ALL_MEDIA.map((item) => [item.url, item.width / item.height]));
