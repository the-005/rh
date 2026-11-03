/**
 * The admin's Worker (rh-admin): the admin page and everything it saves.
 *
 * Its whole address sits behind Cloudflare Access (only the people on the
 * Access policy can reach it), and every request is checked here too: Access
 * signs each request it lets through, and the signature is verified against
 * the team's keys and this application's tag before anything else runs. With
 * no tag configured nothing gets through.
 *
 * Files go straight to storage (the rh-media bucket) in 10 MB pieces, so a
 * video of several GB uploads like a photo. Saving a project writes its
 * project.json and queues what's new: images for their web copies (made by
 * the processing on GitHub, see scripts/process-media.ts), videos for the
 * Preview Cutter.
 */

import { createRemoteJWKSet, jwtVerify } from "jose";
import { CUTTER_PREFIX, type Item, isId, keys, PROCESS_PREFIX, type Project, type QueueEntry, type Status } from "./shared.ts";

interface Env {
  ASSETS: Fetcher;
  MEDIA: R2Bucket;
  // The public site, for copying today's web images into storage.
  SITE: Fetcher;
  TEAM_DOMAIN: string;
  POLICY_AUD: string;
  // Local development only (.dev.vars), and only honoured on localhost.
  DEV_BYPASS?: string;
}

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json" } });

const fail = (message: string, status = 400) => json({ error: message }, status);

let jwks: ReturnType<typeof createRemoteJWKSet> | undefined;

async function signedInAs(request: Request, env: Env) {
  const host = new URL(request.url).hostname;
  if (env.DEV_BYPASS === "1" && (host === "localhost" || host === "127.0.0.1")) return "dev@localhost";
  const token = request.headers.get("Cf-Access-Jwt-Assertion");
  if (!token || !env.TEAM_DOMAIN || !env.POLICY_AUD) return null;
  jwks ??= createRemoteJWKSet(new URL(`${env.TEAM_DOMAIN}/cdn-cgi/access/certs`));
  try {
    const { payload } = await jwtVerify(token, jwks, { issuer: env.TEAM_DOMAIN, audience: env.POLICY_AUD });
    return typeof payload.email === "string" ? payload.email : null;
  } catch {
    return null;
  }
}

async function readJson<T>(env: Env, key: string): Promise<T | null> {
  const object = await env.MEDIA.get(key);
  return object ? ((await object.json()) as T) : null;
}

const writeJson = (env: Env, key: string, data: unknown) =>
  env.MEDIA.put(key, JSON.stringify(data), { httpMetadata: { contentType: "application/json" } });

async function order(env: Env) {
  return (await readJson<{ order: string[] }>(env, keys.index))?.order ?? [];
}

// Item ids within a key prefix like queue/cutter/<project>__.
async function queued(env: Env, prefix: string, project: string) {
  const listed = await env.MEDIA.list({ prefix: `${prefix}${project}__` });
  return listed.objects.map((o) => o.key.slice(prefix.length + project.length + 2, -".json".length));
}

const coverOf = (project: Project, status: Status) => {
  for (const item of project.items) {
    const canvas = item.copies?.canvas ?? status[item.id]?.copies?.canvas;
    if (canvas) return canvas;
  }
  return null;
};

async function listProjects(env: Env) {
  const ids = await order(env);
  const projects = await Promise.all(
    ids.map(async (id) => {
      const [project, status] = await Promise.all([
        readJson<Project>(env, keys.project(id)),
        readJson<Status>(env, keys.status(id)),
      ]);
      if (!project) return null;
      const s = status ?? {};
      return {
        id,
        name: project.name,
        kind: project.kind,
        year: project.year,
        images: project.items.filter((i) => i.type === "image").length,
        videos: project.items.filter((i) => i.type === "video").length,
        cover: coverOf(project, s),
        updated: project.updated,
      };
    })
  );
  return projects.filter((p) => p !== null);
}

async function getProject(env: Env, id: string) {
  const [project, status, processing, cutter] = await Promise.all([
    readJson<Project>(env, keys.project(id)),
    readJson<Status>(env, keys.status(id)),
    queued(env, PROCESS_PREFIX, id),
    queued(env, CUTTER_PREFIX, id),
  ]);
  if (!project) return null;
  return { project, status: status ?? {}, processing, cutter };
}

const str = (value: unknown, max: number) => (typeof value === "string" ? value.trim().slice(0, max) : "");

// What the page sent, kept to the shape of a project and to keys inside its
// own folder.
function clean(body: Project, id: string, existing: Project | null): Project | string {
  const name = str(body.name, 200);
  if (!name) return "A project needs a name.";
  const own = `projects/${id}/`;
  const items: Item[] = [];
  const seen = new Set<string>();
  for (const raw of Array.isArray(body.items) ? body.items : []) {
    const itemId = str(raw?.id, 80);
    if (!/^[\w-]+$/.test(itemId) || seen.has(itemId)) return "An item has a bad id.";
    seen.add(itemId);
    const type = raw.type === "video" ? "video" : "image";
    const item: Item = { id: itemId, type, file: str(raw.file, 300) || itemId };
    if (raw.original) {
      if (typeof raw.original !== "string" || !raw.original.startsWith(`${own}originals/`)) return "Bad original.";
      item.original = raw.original;
    }
    if (typeof raw.size === "number") item.size = raw.size;
    // Copies only ever come from storage, never from the page: keep what the
    // saved project already had for this item.
    const before = existing?.items.find((i) => i.id === itemId);
    if (before?.copies) item.copies = before.copies;
    if (before?.width) item.width = before.width;
    if (before?.height) item.height = before.height;
    items.push(item);
  }
  const credits = (Array.isArray(body.credits) ? body.credits : [])
    .map((c) => ({ role: str(c?.role, 100), name: str(c?.name, 200) }))
    .filter((c) => c.role || c.name);
  const now = new Date().toISOString();
  return {
    id,
    name,
    kind: str(body.kind, 100),
    year: str(body.year, 40),
    credits,
    items,
    created: existing?.created ?? now,
    updated: now,
  };
}

async function saveProject(request: Request, env: Env, id: string, create: boolean) {
  const existing = await readJson<Project>(env, keys.project(id));
  if (create && existing) return fail("A project with this name already exists.", 409);
  const body = (await request.json()) as Project;
  // Copies come with a project only when it's brought in from the site.
  const imported = create && body.items.every((i) => i.copies);
  const project = clean(body, id, existing);
  if (typeof project === "string") return fail(project);
  if (imported) {
    project.items = project.items.map((item, i) => ({
      ...item,
      copies: body.items[i].copies,
      width: body.items[i].width,
      height: body.items[i].height,
    }));
    if (!project.items.every((i) => i.copies && Object.values(i.copies).every((k) => k.startsWith(`projects/${id}/web/`))))
      return fail("Bad copies.");
  }

  const before = new Map((existing?.items ?? []).map((i) => [i.id, i]));
  const after = new Set(project.items.map((i) => i.id));
  const status = (await readJson<Status>(env, keys.status(id))) ?? {};

  // Removed items: their files and their places in the queues go too.
  const gone = [...before.values()].filter((i) => !after.has(i.id));
  const deletions = gone.flatMap((item) => [
    ...(item.original ? [item.original] : []),
    ...Object.values(item.copies ?? {}),
    ...Object.values(status[item.id]?.copies ?? {}),
    keys.process(id, item.id),
    keys.cutter(id, item.id),
  ]);
  if (deletions.length) await env.MEDIA.delete(deletions);

  // New items: images wait for their copies, videos for their preview.
  const fresh = project.items.filter((i) => !before.has(i.id) && i.original);
  await Promise.all(
    fresh.map((item) => {
      const entry: QueueEntry = { project: id, item: item.id, original: item.original as string, file: item.file };
      return writeJson(env, item.type === "image" ? keys.process(id, item.id) : keys.cutter(id, item.id), entry);
    })
  );

  await writeJson(env, keys.project(id), project);
  const ids = await order(env);
  if (!ids.includes(id)) await writeJson(env, keys.index, { order: [...ids, id] });
  return json(await getProject(env, id));
}

const isOriginal = (key: string | null): key is string => !!key && /^projects\/[\w-]+\/originals\/[\w.-]+$/.test(key);

async function uploads(request: Request, env: Env, url: URL) {
  if (request.method === "POST") {
    const body = (await request.json()) as { key: string; contentType?: string };
    if (!isOriginal(body.key)) return fail("Bad key.");
    const upload = await env.MEDIA.createMultipartUpload(body.key, {
      httpMetadata: { contentType: body.contentType || "application/octet-stream" },
    });
    return json({ key: upload.key, uploadId: upload.uploadId });
  }
  const key = url.searchParams.get("key");
  const uploadId = url.searchParams.get("uploadId");
  if (!isOriginal(key) || !uploadId) return fail("Bad upload.");
  const upload = env.MEDIA.resumeMultipartUpload(key, uploadId);
  if (request.method === "PUT") {
    const part = Number(url.searchParams.get("part"));
    if (!Number.isInteger(part) || part < 1 || part > 10000 || !request.body) return fail("Bad part.");
    return json(await upload.uploadPart(part, request.body));
  }
  if (request.method === "DELETE") {
    await upload.abort();
    return json({ ok: true });
  }
  return fail("Method not allowed.", 405);
}

async function completeUpload(request: Request, env: Env) {
  const body = (await request.json()) as { key: string; uploadId: string; parts: R2UploadedPart[] };
  if (!isOriginal(body.key)) return fail("Bad key.");
  const object = await env.MEDIA.resumeMultipartUpload(body.key, body.uploadId).complete(body.parts);
  return json({ key: object.key, size: object.size });
}

// Today's web copies, copied from the site into storage, a few per request.
async function importCopies(request: Request, env: Env) {
  const body = (await request.json()) as { copies: { from: string; to: string }[] };
  if (!Array.isArray(body.copies) || body.copies.length > 12) return fail("Up to 12 at a time.");
  let copied = 0;
  for (const { from, to } of body.copies) {
    if (!/^work\/[^?#]+\.jpg$/.test(from) || !/^projects\/[\w-]+\/web\/(full|mid|canvas)\/[\w-]+\.jpg$/.test(to))
      return fail("Bad copy.");
    if (await env.MEDIA.head(to)) continue;
    const response = await env.SITE.fetch(`https://site/${from.split("/").map(encodeURIComponent).join("/")}`);
    if (!response.ok) return fail(`Couldn't read ${from} from the site (${response.status}).`, 502);
    await env.MEDIA.put(to, await response.arrayBuffer(), { httpMetadata: { contentType: "image/jpeg" } });
    copied++;
  }
  return json({ copied });
}

// A file from storage, with ranges so a video can play and seek.
async function media(request: Request, env: Env, key: string) {
  if (!/^projects\/[\w-]+\//.test(key)) return fail("Not found.", 404);
  const object = await env.MEDIA.get(key, { range: request.headers, onlyIf: request.headers });
  if (!object) return fail("Not found.", 404);
  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set("etag", object.httpEtag);
  headers.set("cache-control", "private, max-age=3600");
  headers.set("accept-ranges", "bytes");
  if (!("body" in object)) return new Response(null, { status: 304, headers });
  const range = object.range as { offset?: number; length?: number; suffix?: number } | undefined;
  if (range && request.headers.has("range")) {
    const offset = range.suffix !== undefined ? object.size - range.suffix : (range.offset ?? 0);
    const length = range.suffix ?? range.length ?? object.size - offset;
    headers.set("content-range", `bytes ${offset}-${offset + length - 1}/${object.size}`);
    headers.set("content-length", String(length));
    return new Response(object.body, { status: 206, headers });
  }
  return new Response(object.body, { headers });
}

export default {
  async fetch(request, env) {
    const email = await signedInAs(request, env);
    if (!email) return new Response("Sign in through Cloudflare Access to use the admin.", { status: 403 });

    const url = new URL(request.url);
    const path = url.pathname;
    const method = request.method;
    try {
      if (path === "/api/me") return json({ email });
      if (path === "/api/projects" && method === "GET") return json(await listProjects(env));
      const match = path.match(/^\/api\/projects\/([^/]+)$/);
      if (match) {
        const id = decodeURIComponent(match[1]);
        if (!isId(id)) return fail("Bad project id.");
        if (method === "GET") {
          const found = await getProject(env, id);
          return found ? json(found) : fail("No such project.", 404);
        }
        if (method === "PUT") return await saveProject(request, env, id, url.searchParams.has("create"));
        return fail("Method not allowed.", 405);
      }
      if (path === "/api/uploads") return await uploads(request, env, url);
      if (path === "/api/uploads/complete" && method === "POST") return await completeUpload(request, env);
      if (path === "/api/import" && method === "POST") return await importCopies(request, env);
      if (path.startsWith("/media/") && method === "GET") return await media(request, env, decodeURIComponent(path.slice(7)));
      if (path.startsWith("/api/")) return fail("Not found.", 404);
      return env.ASSETS.fetch(request);
    } catch (error) {
      return fail(error instanceof Error ? error.message : String(error), 500);
    }
  },
} satisfies ExportedHandler<Env>;
