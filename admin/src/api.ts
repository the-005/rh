import type { Project, Status } from "../shared.ts";

export type Summary = {
  id: string;
  name: string;
  kind: string;
  year: string;
  images: number;
  videos: number;
  cover: string | null;
  updated: string;
};

// A project as the admin Worker returns it: what was saved, how the
// processing went per item, and which items still wait in each queue.
export type Loaded = { project: Project; status: Status; processing: string[]; cutter: string[] };

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
  project: (id: string) => call<Loaded>("GET", `/api/projects/${encodeURIComponent(id)}`),
  save: (project: Project, create: boolean) =>
    call<Loaded>("PUT", `/api/projects/${encodeURIComponent(project.id)}${create ? "?create" : ""}`, project),
};

export const mediaUrl = (key: string) => `/media/${key.split("/").map(encodeURIComponent).join("/")}`;
