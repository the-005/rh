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
 * the name as a string while its role isn't known, which shows "Role" in its
 * place. A stand-in word rather than a guess: a made-up role beside a real
 * person's name could be read as true.
 */
type ProjectInfo = { name?: string; kind?: string; year?: string; credits?: (string | { role?: string; name: string })[] };
const INFO: Record<string, ProjectInfo> = projectInfo;

/**
 * Stand-ins for a project with no entry in `info.json` yet. The credits run
 * from two to six down the list, so some rows show all of theirs and some a
 * "+N", and the roles and names vary in length (short, long, hyphenated, a
 * middle name, a studio) to show how real ones would sit. Names, kinds and
 * years vary in length too (the owner, 2 Nov), from one word to a name long
 * enough to wrap, so the rows show what has to move around the picture. Still
 * plainly placeholders: no real person's name, no real project.
 */
const PLACEHOLDER_TITLES = [
  "Project name",
  "Name",
  "A longer project name",
  "Project name for a campaign in several parts",
  "Short",
  "Project name, chapter two",
  "Title of the project",
  "A project name that runs on for quite a while",
  "Two words",
  "Project",
  "Project name with a subtitle",
];
const PLACEHOLDER_KINDS = ["Kind", "Longer kind", "Kind of work", "Kind", "A longer kind of work"];
const PLACEHOLDER_YEARS = ["Year", "Season Year", "Year", "Season, Year", "Year–Year"];
const PLACEHOLDER_ROLES = [
  "Photography",
  "Styling",
  "Hair",
  "Make-up",
  "Set design",
  "Art direction",
  "Casting",
  "Production",
  "Retouching",
  "Assistant",
];
const PLACEHOLDER_NAMES = [
  "Name Surname",
  "Firstname Lastname",
  "N. Surname",
  "Name Double-Surname",
  "Firstname Middle Lastname",
  "Name van Surname",
  "Studio Name",
  "Na Me",
];
function placeholder(order: number): Required<ProjectInfo> {
  return {
    name: PLACEHOLDER_TITLES[order % PLACEHOLDER_TITLES.length],
    kind: PLACEHOLDER_KINDS[(order * 2) % PLACEHOLDER_KINDS.length],
    year: PLACEHOLDER_YEARS[(order * 3) % PLACEHOLDER_YEARS.length],
    credits: Array.from({ length: 2 + ((order * 3) % 5) }, (_, i) => ({
      role: PLACEHOLDER_ROLES[(order * 3 + i) % PLACEHOLDER_ROLES.length],
      name: PLACEHOLDER_NAMES[(order * 5 + i * 3) % PLACEHOLDER_NAMES.length],
    })),
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
        typeof credit === "string" ? { role: "Role", name: credit } : { role: credit.role ?? "Role", name: credit.name }
      ),
      count: items.length,
      cover: items[0].url,
      images: items.map((item) => item.url),
    };
  });
})();

/** Width ÷ height of every Work image, by url, for anything sized by its shape. */
export const ASPECTS: ReadonlyMap<string, number> = new Map(ALL_MEDIA.map((item) => [item.url, item.width / item.height]));

/** Each image's 1500px copy, keyed by its full-size url. */
export const MID_COPIES: ReadonlyMap<string, string> = new Map(ALL_MEDIA.map((item) => [item.url, item.midUrl]));
