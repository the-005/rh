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
 *   projects/index.json                   the projects, in order
 *   queue/process/<id>__<item>.json       an image waiting for its copies, or a
 *                                         video waiting to be compressed
 *   queue/cutter/<id>__<item>.json        a video waiting for its preview
 */

// The kinds of work a project can be: one per project. Defaults until the
// owner gives the real list (4 Nov).
export const KINDS = ["Editorial", "Campaign", "Commission", "Personal"];

// How videos are compressed: the owner's HandBrake settings (4 Nov), this
// preset with cropping set to none, nothing else changed.
export const HANDBRAKE_PRESET = "Fast 2160p60 4K HEVC";

// Offered while typing a collaborator's role; any role can be written.
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
  created: string;
  updated: string;
};

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

export type QueueEntry = { project: string; item: string; type: Item["type"]; original: string; file: string };

export const keys = {
  index: "projects/index.json",
  project: (id: string) => `projects/${id}/project.json`,
  status: (id: string) => `projects/${id}/status.json`,
  original: (id: string, item: string, file: string) => `projects/${id}/originals/${item}-${safeName(file)}`,
  web: (id: string, size: keyof Copies, item: string) => `projects/${id}/web/${size}/${item}.jpg`,
  video: (id: string, item: string) => `projects/${id}/web/video/${item}.mp4`,
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
