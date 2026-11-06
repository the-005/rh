import type { Options, Piece, PreviewPlan, Project, Splash, Status } from "../shared.ts";

export type Summary = {
  id: string;
  name: string;
  kind: string;
  year: string;
  images: number;
  videos: number;
  cover: string | null;
  // On the public site ("Show on the site").
  shown: boolean;
  updated: string;
};

// A project as the admin Worker returns it: what was saved, how the
// processing went per item, and which items still wait in each queue.
export type Loaded = { project: Project; status: Status; processing: string[]; cutter: string[] };

// A video as the Preview Cutter lists it.
export type CutterRow = {
  project: string;
  projectName: string;
  item: string;
  file: string;
  todo: boolean;
  preview: "processing" | "done" | "failed" | null;
  compressed: string | null;
};

export class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

export async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
  const response = await fetch(path, {
    method,
    headers: body === undefined ? undefined : { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new ApiError((data as { error?: string }).error ?? `Error ${response.status}`, response.status);
  return data as T;
}

export const api = {
  me: () => call<{ email: string }>("GET", "/api/me"),
  projects: () => call<Summary[]>("GET", "/api/projects"),
  options: () => call<Options>("GET", "/api/options"),
  removeOption: (list: "kinds" | "roles", value: string) => call<Options>("POST", "/api/options/remove", { list, value }),
  deleteProject: (id: string) => call<{ deleted: string }>("DELETE", `/api/projects/${encodeURIComponent(id)}`),
  project: (id: string) => call<Loaded>("GET", `/api/projects/${encodeURIComponent(id)}`),
  order: (order: string[]) => call<{ order: string[] }>("PUT", "/api/order", { order }),
  cutter: () => call<CutterRow[]>("GET", "/api/cutter"),
  plan: (project: string, item: string) =>
    call<PreviewPlan>("GET", `/api/previews/${encodeURIComponent(project)}/${encodeURIComponent(item)}`),
  savePlan: (project: string, item: string, body: { cuts?: number[]; pieces?: Piece[] }) =>
    call<PreviewPlan>("PUT", `/api/previews/${encodeURIComponent(project)}/${encodeURIComponent(item)}`, body),
  splash: () => call<Splash>("GET", "/api/splash"),
  saveSplash: (body: { item: string; file: string; original: string; size: number }) => call<Splash>("PUT", "/api/splash", body),
  save: (project: Project, create: boolean) =>
    call<Loaded>("PUT", `/api/projects/${encodeURIComponent(project.id)}${create ? "?create" : ""}`, project),
};

export const mediaUrl = (key: string) => `/media/${key.split("/").map(encodeURIComponent).join("/")}`;
