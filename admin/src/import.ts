/**
 * Brings the site's 11 projects into storage the first time the admin opens:
 * their three web copies are copied from the site (12 per request, the
 * Worker's limit), then each project is saved with what src/projects/info.json
 * says about it. Run again, it skips whatever is already there.
 */

import info from "../../src/projects/info.json";
import manifest from "../../src/work/manifest.json";
import { type Credit, type Item, keys, type Project } from "../shared.ts";
import { ApiError, api, call } from "./api.ts";

type Info = { name?: string; kind?: string; year?: string; credits?: (string | Credit)[] };

function plan() {
  const projects = new Map<string, Project>();
  const copies: { from: string; to: string }[] = [];
  const details = info as Record<string, Info>;
  for (const entry of manifest) {
    const id = entry.project;
    let project = projects.get(id);
    if (!project) {
      const about = details[id] ?? {};
      project = {
        id,
        name: about.name ?? id,
        kind: about.kind ?? "",
        year: about.year ?? "",
        credits: (about.credits ?? []).map((c) => (typeof c === "string" ? { role: "", name: c } : c)),
        items: [],
        created: "",
        updated: "",
      };
      projects.set(id, project);
    }
    const file = entry.url.split("/").pop() as string;
    let itemId = file.replace(/\.jpg$/i, "").replace(/[^\w-]+/g, "-");
    while (project.items.some((i) => i.id === itemId)) itemId += "-";
    const item: Item = {
      id: itemId,
      type: "image",
      file,
      copies: {
        full: keys.web(id, "full", itemId),
        mid: keys.web(id, "mid", itemId),
        canvas: keys.web(id, "canvas", itemId),
      },
      width: entry.width,
      height: entry.height,
    };
    project.items.push(item);
    copies.push(
      { from: entry.url, to: item.copies?.full as string },
      { from: entry.midUrl, to: item.copies?.mid as string },
      { from: entry.canvasUrl, to: item.copies?.canvas as string }
    );
  }
  return { projects: [...projects.values()], copies };
}

export async function importSite(progress: (message: string) => void) {
  const { projects, copies } = plan();
  for (let i = 0; i < copies.length; i += 12) {
    progress(`Copying the site's images into storage: ${i} of ${copies.length}`);
    await call("POST", "/api/import", { copies: copies.slice(i, i + 12) });
  }
  for (const [i, project] of projects.entries()) {
    progress(`Saving the projects: ${i} of ${projects.length}`);
    try {
      await api.save(project, true);
    } catch (error) {
      // Already brought in: leave it as it is.
      if (!(error instanceof ApiError && error.status === 409)) throw error;
    }
  }
}
