/**
 * shared.ts — what a project is in storage, and where each piece of it lives.
 * Read by the admin page, the admin Worker, the site's Worker (the door the
 * processing comes through) and the processing script.
 *
 * Storage is the rh-media bucket (Cloudflare R2). Each project is one folder:
 *
 *   projects/<id>/project.json            what the admin saves: info + items in order
 *   projects/<id>/status.json             what the processing writes, per item
 *   projects/<id>/originals/<item>-<file> files as uploaded
 *   projects/<id>/web/full/<item>.jpg     3000px copy   } the three copies the
 *   projects/<id>/web/mid/<item>.jpg      1500px copy   } site uses today
 *   projects/<id>/web/canvas/<item>.jpg   1000px copy   } (see CLAUDE.md, Media)
 *   projects/<id>/web/video/<item>.mp4    a video, compressed with HandBrake
 *   projects/<id>/web/preview/<item>.mp4  its looping preview, made from the pieces
 *   projects/<id>/previews/<item>.json    the Preview Cutter's cuts and pieces
 *   projects/index.json                   the projects, in order
 *   options.json                          the kinds of work and roles to pick from
 *   queue/process/<id>__<item>.json       an image waiting for its copies, or a
 *                                         video waiting to be compressed
 *   queue/process/<id>__<item>__preview.json  a preview waiting to be made
 *   queue/cutter/<id>__<item>.json        a video waiting for its preview
 */

// Where the site is, for the admin's links to each project on it. Changes when
// the site moves to Ruben's domain.
export const SITE_URL = "https://rh.rh-3b6.workers.dev";

// The kinds of work a project can be (one per project) and the roles a
// collaborator can have: what the lists start with. Anything typed that isn't
// on a list is added to it when the project is saved (options.json), after
// Notion's selects (the owner, 4 Nov: "add an option that doesn't exist").
export const KINDS = ["Editorial", "Campaign", "Commission", "Personal"];

// How videos are compressed: the owner's HandBrake settings (4 Nov), this
// preset with cropping set to none, nothing else changed, but at "2K" rather
// than 4K (the owner, same day; HEVC confirmed over AV1): at most 2560 on the
// long side and 1440 on the short, turned to suit each video, never enlarged.
// HandBrake has no HEVC preset at 1440p, so the 4K one is capped.
export const HANDBRAKE_PRESET = "Fast 2160p60 4K HEVC";
export const VIDEO_LONG_SIDE = 2560;
export const VIDEO_SHORT_SIDE = 1440;

export const ROLES = [
  "Photography",
  "Styling",
  "Hair",
  "Make-up",
  "Set design",
  "Art direction",
  "Casting",
  "Model",
  "Production",
  "Video",
];

export type Options = { kinds: string[]; roles: string[] };

export type Credit = { role: string; name: string };

export type Copies = { full: string; mid: string; canvas: string };

export type Item = {
  id: string;
  type: "image" | "video";
  // The file's name as it was uploaded (or, for the projects brought in from
  // the site, the name of its web copy).
  file: string;
  // Storage key of the file as uploaded. The 11 projects brought in from the
  // site have no originals in storage, only their web copies.
  original?: string;
  size?: number;
  // Web copies an item came with (the projects brought in from the site).
  copies?: Copies;
  width?: number;
  height?: number;
};

export type Project = {
  id: string;
  name: string;
  kind: string;
  year: string;
  credits: Credit[];
  // In order of appearance.
  items: Item[];
  // Shown on the public site ("Show on the site" in the admin). Unset means
  // shown for the 11 projects brought in from the site, hidden for the rest.
  published?: boolean;
  created: string;
  updated: string;
};

// Brought in from the site: its images came with their web copies (videos
// and images added through the admin since don't change that).
export const fromSite = (project: Project) => project.items.some((i) => i.copies);

// On the site unless switched off; projects made in the admin start off.
export const shownOnSite = (project: Project) => project.published ?? fromSite(project);

export type ItemStatus = {
  state: "processing" | "done" | "failed";
  message?: string;
  copies?: Copies;
  // A video's compressed version.
  video?: string;
  width?: number;
  height?: number;
  at: string;
};

export type Status = Record<string, ItemStatus>;

// A job for the processing: an image's copies, a video's compression, or a
// video's preview made from the pieces picked in the Preview Cutter.
export type QueueEntry = {
  project: string;
  item: string;
  type: Item["type"] | "preview";
  original: string;
  file: string;
  pieces?: Piece[];
};

// A stretch of a video, in seconds. A preview is up to PREVIEW_MAX seconds of
// pieces joined with straight cuts, looping.
export type Piece = { s: number; e: number };
export const PREVIEW_MAX = 10;
export const PIECE_MIN = 0.3;

// What the Preview Cutter keeps per video: the cuts it found (so reopening is
// instant) and the pieces last saved.
export type PreviewPlan = { cuts?: number[]; pieces?: Piece[]; saved?: string };

// Status entries for previews sit beside the video's own, under this id.
export const previewStatusId = (item: string) => `${item}__preview`;

export const keys = {
  index: "projects/index.json",
  options: "options.json",
  project: (id: string) => `projects/${id}/project.json`,
  status: (id: string) => `projects/${id}/status.json`,
  original: (id: string, item: string, file: string) => `projects/${id}/originals/${item}-${safeName(file)}`,
  web: (id: string, size: keyof Copies, item: string) => `projects/${id}/web/${size}/${item}.jpg`,
  video: (id: string, item: string) => `projects/${id}/web/video/${item}.mp4`,
  preview: (id: string, item: string) => `projects/${id}/web/preview/${item}.mp4`,
  plan: (id: string, item: string) => `projects/${id}/previews/${item}.json`,
  processPreview: (id: string, item: string) => `queue/process/${id}__${item}__preview.json`,
  process: (id: string, item: string) => `queue/process/${id}__${item}.json`,
  cutter: (id: string, item: string) => `queue/cutter/${id}__${item}.json`,
};

export const PROCESS_PREFIX = "queue/process/";
export const CUTTER_PREFIX = "queue/cutter/";

// A file name that's safe in a storage key and a URL: letters, digits, dot,
// dash and underscore; anything else becomes a dash.
export function safeName(name: string) {
  return name.normalize("NFKD").replace(/[^\w.-]+/g, "-");
}

// A project id from its name, as /project/<id> on the site: lowercase words
// joined by dashes.
export function slug(name: string) {
  return (
    name
      .normalize("NFKD")
      .replace(/[̀-ͯ]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60) || "project"
  );
}

// Ids are folder names for the 11 projects from the site (PR-02_HE) and slugs
// for new ones; either way nothing that could climb out of its folder.
export const isId = (id: string) => /^[\w-]{1,80}$/.test(id);

export const isImage = (file: string, contentType = "") =>
  contentType.startsWith("image/") || /\.(jpe?g|png|tiff?|webp|heic|heif|avif|gif)$/i.test(file);

export const isVideo = (file: string, contentType = "") =>
  contentType.startsWith("video/") || /\.(mp4|mov|m4v|webm|mkv|avi|mxf)$/i.test(file);
