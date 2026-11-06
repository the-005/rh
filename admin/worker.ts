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
 * project.json and queues what's new for the processing on GitHub (see
 * scripts/process-media.ts): images for their web copies, videos to be
 * compressed with HandBrake. Videos also go to the Preview Cutter's queue.
 *
 * Once a day it deletes the originals that are no longer needed
 * (admin/originals.ts).
 */

import { createRemoteJWKSet, jwtVerify } from "jose";
import { deleteOldOriginals } from "./originals.ts";
import { publishSite } from "./site-data.ts";
import {
  CUTTER_PREFIX,
  type Item,
  isId,
  KINDS,
  keys,
  type Options,
  PIECE_MIN,
  PREVIEW_MAX,
  type Piece,
  PROCESS_PREFIX,
  type PreviewPlan,
  type Project,
  previewStatusId,
  type QueueEntry,
  ROLES,
  SPLASH_PROJECT,
  type Splash,
  type Status,
  shownOnSite,
} from "./shared.ts";

interface Env {
  ASSETS: Fetcher;
  MEDIA: R2Bucket;
  // The public site, for copying today's web images into storage.
  SITE: Fetcher;
  TEAM_DOMAIN: string;
  POLICY_AUD: string;
  // Local development only (.dev.vars), and only honoured on localhost.
  DEV_BYPASS?: string;
  // A GitHub key that may start the processing workflow (Actions: read and
  // write, on the-005/rh only), set as a secret in the dashboard. Without it,
  // processing waits for the workflow's schedule or a run started by hand.
  GITHUB_TOKEN?: string;
}

// Starts the processing on GitHub now, rather than at its next scheduled run
// (which GitHub may start late, or, as on 4 Nov, not at all). A run already
// going picks up new work at its end; the workflow lets only one run at a time.
function startProcessing(env: Env, ctx: ExecutionContext) {
  if (!env.GITHUB_TOKEN) return;
  ctx.waitUntil(
    fetch("https://api.github.com/repos/the-005/rh/actions/workflows/process-media.yml/dispatches", {
      method: "POST",
      headers: {
        authorization: `Bearer ${env.GITHUB_TOKEN}`,
        accept: "application/vnd.github+json",
        "x-github-api-version": "2022-11-28",
        "user-agent": "rh-admin",
      },
      body: JSON.stringify({ ref: "main" }),
    }).catch(() => {})
  );
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
        shown: shownOnSite(project),
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
  const published = typeof body.published === "boolean" ? body.published : existing?.published;
  return {
    id,
    name,
    kind: str(body.kind, 100),
    year: str(body.year, 40),
    credits,
    items,
    ...(published === undefined ? {} : { published }),
    created: existing?.created ?? now,
    updated: now,
  };
}

const options = async (env: Env) => (await readJson<Options>(env, keys.options)) ?? { kinds: KINDS, roles: ROLES };

// A kind or role typed that isn't on its list yet joins it, for every project.
async function remember(env: Env, project: Project) {
  const current = await options(env);
  const add = (list: string[], value: string) =>
    value && !list.some((o) => o.toLowerCase() === value.toLowerCase()) ? [...list, value] : list;
  const kinds = add(current.kinds, project.kind);
  const roles = project.credits.reduce((list, c) => add(list, c.role), current.roles);
  if (kinds.length !== current.kinds.length || roles.length !== current.roles.length)
    await writeJson(env, keys.options, { kinds, roles });
}

async function saveProject(request: Request, env: Env, ctx: ExecutionContext, id: string, create: boolean) {
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
    ...(status[item.id]?.video ? [status[item.id]?.video as string] : []),
    keys.process(id, item.id),
    keys.cutter(id, item.id),
    ...(item.type === "video" ? [keys.preview(id, item.id), keys.plan(id, item.id), keys.processPreview(id, item.id)] : []),
  ]);
  if (deletions.length) await env.MEDIA.delete(deletions);

  // New items: images wait for their copies; videos wait to be compressed and,
  // separately, for their preview in the Preview Cutter.
  const fresh = project.items.filter((i) => !before.has(i.id) && i.original);
  await Promise.all(
    fresh.flatMap((item) => {
      const entry: QueueEntry = {
        project: id,
        item: item.id,
        type: item.type,
        original: item.original as string,
        file: item.file,
      };
      const queues = [keys.process(id, item.id), ...(item.type === "video" ? [keys.cutter(id, item.id)] : [])];
      return queues.map((key) => writeJson(env, key, entry));
    })
  );
  // Videos compressed before they got a still (their first frame, which the
  // site shows) go round again, while their original is still in storage.
  const stillless = (
    await Promise.all(
      project.items
        .filter((i) => i.type === "video" && i.original && status[i.id]?.state === "done" && !status[i.id]?.copies)
        .map(async (i) => ((await env.MEDIA.head(i.original as string)) ? i : null))
    )
  ).filter((i) => i !== null);
  await Promise.all(
    stillless.map((item) =>
      writeJson(env, keys.process(id, item.id), {
        project: id,
        item: item.id,
        type: "video",
        original: item.original as string,
        file: item.file,
      } satisfies QueueEntry)
    )
  );
  if (fresh.length || stillless.length) startProcessing(env, ctx);

  // A project made in the admin starts off the site, until it's switched on.
  if (create && !imported && project.published === undefined) project.published = false;
  await writeJson(env, keys.project(id), project);
  await remember(env, project);
  const ids = await order(env);
  if (!ids.includes(id)) await writeJson(env, keys.index, { order: [...ids, id] });
  await publishSite(env.MEDIA);
  return json(await getProject(env, id));
}

const isOriginal = (key: string | null): key is string => !!key && /^(projects\/[\w-]+|splash)\/originals\/[\w.-]+$/.test(key);

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

// Today's web copies, copied from the site into storage, a few per request,
// all at once: storage is in Western Europe and each copy is a round trip from
// wherever the Worker runs (one at a time it took ~5s an image from Australia).
async function importCopies(request: Request, env: Env) {
  const body = (await request.json()) as { copies: { from: string; to: string }[] };
  if (!Array.isArray(body.copies) || body.copies.length > 12) return fail("Up to 12 at a time.");
  for (const { from, to } of body.copies) {
    if (!/^work\/[^?#]+\.jpg$/.test(from) || !/^projects\/[\w-]+\/web\/(full|mid|canvas)\/[\w-]+\.jpg$/.test(to))
      return fail("Bad copy.");
  }
  const copied = await Promise.all(
    body.copies.map(async ({ from, to }) => {
      if (await env.MEDIA.head(to)) return false;
      const response = await env.SITE.fetch(`https://site/${from.split("/").map(encodeURIComponent).join("/")}`);
      if (!response.ok) throw new Error(`Couldn't read ${from} from the site (${response.status}).`);
      await env.MEDIA.put(to, await response.arrayBuffer(), { httpMetadata: { contentType: "image/jpeg" } });
      return true;
    })
  );
  return json({ copied: copied.filter(Boolean).length });
}

// Deleting a project: every file in its folder (originals, copies, videos,
// previews, its cuts and pieces), its places in the queues and in the order;
// then the site forgets it. The site's own public/work files (the 11 projects
// brought in from it) stay in the code, unlisted.
async function deleteProject(env: Env, id: string) {
  if (!(await readJson<Project>(env, keys.project(id)))) return fail("No such project.", 404);
  for (const prefix of [`projects/${id}/`, `${PROCESS_PREFIX}${id}__`, `${CUTTER_PREFIX}${id}__`]) {
    let cursor: string | undefined;
    do {
      const listed = await env.MEDIA.list({ prefix, cursor, limit: 1000 });
      if (listed.objects.length) await env.MEDIA.delete(listed.objects.map((o) => o.key));
      cursor = listed.truncated ? listed.cursor : undefined;
    } while (cursor);
  }
  await writeJson(env, keys.index, { order: (await order(env)).filter((p) => p !== id) });
  await publishSite(env.MEDIA);
  return json({ deleted: id });
}

// An option off its list (kinds of work, or roles). Projects that use it keep
// it; saving one of them puts it back on the list.
async function removeOption(request: Request, env: Env) {
  const body = (await request.json()) as { list?: string; value?: string };
  if (body.list !== "kinds" && body.list !== "roles") return fail("Bad list.");
  const current = await options(env);
  const value = String(body.value ?? "").toLowerCase();
  const next = { ...current, [body.list]: current[body.list].filter((o) => o.toLowerCase() !== value) };
  await writeJson(env, keys.options, next);
  return json(next);
}

// The projects' order, as dragged on the admin's list: the same projects, in a
// new order (the site follows it, through site.json).
async function saveOrder(request: Request, env: Env) {
  const body = (await request.json()) as { order?: unknown };
  const current = await order(env);
  const next = Array.isArray(body.order) ? body.order.filter((id): id is string => typeof id === "string") : [];
  if (next.length !== current.length || new Set(next).size !== next.length || !next.every((id) => current.includes(id)))
    return fail("The order has to list every project once.");
  await writeJson(env, keys.index, { order: next });
  await publishSite(env.MEDIA);
  return json({ order: next });
}

// The splash video: a new one, once uploaded, waits to be made (H.264, for
// every browser; scripts/process-media.ts) and replaces the one on the site
// when it's done. A newer upload replaces one still waiting.
async function saveSplash(request: Request, env: Env, ctx: ExecutionContext) {
  const body = (await request.json()) as { item?: string; file?: string; original?: string; size?: number };
  const item = str(body.item, 40);
  const file = str(body.file, 300);
  if (!/^[\w-]+$/.test(item) || !file || body.original !== keys.splashOriginal(item, file)) return fail("Bad video.");
  if (!(await env.MEDIA.head(body.original))) return fail("The upload isn't there.");
  const splash = (await readJson<Splash>(env, keys.splash)) ?? {};
  if (splash.next && splash.next.item !== item)
    await env.MEDIA.delete([splash.next.original, keys.process(SPLASH_PROJECT, splash.next.item)]);
  const at = new Date().toISOString();
  splash.next = {
    item,
    file,
    original: body.original,
    ...(typeof body.size === "number" ? { size: body.size } : {}),
    state: "waiting",
    at,
  };
  const entry: QueueEntry = { project: SPLASH_PROJECT, item, type: "splash", original: body.original, file };
  await writeJson(env, keys.process(SPLASH_PROJECT, item), entry);
  await writeJson(env, keys.splash, splash);
  startProcessing(env, ctx);
  return json(splash);
}

// The Preview Cutter's list: every video in every project, whether its preview
// is still to do (in the cutter queue), being made, or made.
async function cutterList(env: Env) {
  const ids = await order(env);
  const waiting = new Set(
    (await env.MEDIA.list({ prefix: CUTTER_PREFIX, limit: 1000 })).objects.map((o) =>
      o.key.slice(CUTTER_PREFIX.length, -".json".length)
    )
  );
  const rows = await Promise.all(
    ids.map(async (id) => {
      const [project, status] = await Promise.all([
        readJson<Project>(env, keys.project(id)),
        readJson<Status>(env, keys.status(id)),
      ]);
      if (!project) return [];
      return project.items
        .filter((i) => i.type === "video")
        .map((item) => {
          const preview = status?.[previewStatusId(item.id)];
          return {
            project: id,
            projectName: project.name,
            item: item.id,
            file: item.file,
            todo: waiting.has(`${id}__${item.id}`),
            preview: preview?.state ?? null,
            compressed: status?.[item.id]?.state === "done" ? (status?.[item.id]?.video ?? null) : null,
          };
        });
    })
  );
  return rows.flat();
}

function cleanPieces(raw: unknown): Piece[] | string {
  if (!Array.isArray(raw) || raw.length === 0) return "No pieces.";
  const pieces = raw
    .map((p) => ({ s: Number(p?.s), e: Number(p?.e) }))
    .filter((p) => Number.isFinite(p.s) && Number.isFinite(p.e))
    .sort((a, b) => a.s - b.s);
  if (pieces.length !== raw.length) return "Bad pieces.";
  let total = 0;
  for (const [i, p] of pieces.entries()) {
    if (p.s < 0 || p.e - p.s < PIECE_MIN - 1e-3) return "A piece is too short.";
    if (i > 0 && p.s < pieces[i - 1].e - 1e-3) return "Pieces overlap.";
    total += p.e - p.s;
  }
  if (total > PREVIEW_MAX + 0.05) return `Pieces add up to more than ${PREVIEW_MAX} s.`;
  return pieces;
}

// A video's cuts and pieces. Saving pieces queues the preview to be made (cut
// from the compressed video) and takes the video off the cutter's to-do list;
// cuts alone are only kept.
async function previews(request: Request, env: Env, ctx: ExecutionContext, id: string, itemId: string) {
  const planKey = keys.plan(id, itemId);
  if (request.method === "GET") return json((await readJson<PreviewPlan>(env, planKey)) ?? {});
  if (request.method !== "PUT") return fail("Method not allowed.", 405);
  const project = await readJson<Project>(env, keys.project(id));
  const item = project?.items.find((i) => i.id === itemId && i.type === "video");
  if (!project || !item) return fail("No such video.", 404);
  const body = (await request.json()) as { cuts?: unknown; pieces?: unknown };
  const plan = (await readJson<PreviewPlan>(env, planKey)) ?? {};
  if (Array.isArray(body.cuts)) plan.cuts = body.cuts.map(Number).filter(Number.isFinite).slice(0, 5000);
  if (body.pieces !== undefined) {
    const pieces = cleanPieces(body.pieces);
    if (typeof pieces === "string") return fail(pieces);
    if (!(await env.MEDIA.head(keys.video(id, itemId)))) return fail("The video is still being compressed.");
    plan.pieces = pieces;
    plan.saved = new Date().toISOString();
    // Saved by hand: no longer the automatic suggestion.
    delete plan.auto;
    const entry: QueueEntry = { project: id, item: itemId, type: "preview", file: item.file, pieces };
    await writeJson(env, keys.processPreview(id, itemId), entry);
    await env.MEDIA.delete(keys.cutter(id, itemId));
    startProcessing(env, ctx);
  }
  await writeJson(env, planKey, plan);
  return json(plan);
}

// A file from storage, with ranges so a video can play and seek.
async function media(request: Request, env: Env, key: string) {
  if (!/^(projects\/[\w-]+|splash)\//.test(key)) return fail("Not found.", 404);
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
  async fetch(request, env, ctx) {
    const email = await signedInAs(request, env);
    if (!email) return new Response("Sign in through Cloudflare Access to use the admin.", { status: 403 });

    const url = new URL(request.url);
    const path = url.pathname;
    const method = request.method;
    try {
      if (path === "/api/me") return json({ email });
      if (path === "/api/projects" && method === "GET") return json(await listProjects(env));
      if (path === "/api/options" && method === "GET") return json(await options(env));
      if (path === "/api/options/remove" && method === "POST") return await removeOption(request, env);
      if (path === "/api/cutter" && method === "GET") return json(await cutterList(env));
      if (path === "/api/order" && method === "PUT") return await saveOrder(request, env);
      if (path === "/api/splash" && method === "GET") return json((await readJson<Splash>(env, keys.splash)) ?? {});
      if (path === "/api/splash" && method === "PUT") return await saveSplash(request, env, ctx);
      const previewMatch = path.match(/^\/api\/previews\/([^/]+)\/([^/]+)$/);
      if (previewMatch) {
        const [id, itemId] = [decodeURIComponent(previewMatch[1]), decodeURIComponent(previewMatch[2])];
        if (!isId(id) || !/^[\w-]+$/.test(itemId)) return fail("Bad video.");
        return await previews(request, env, ctx, id, itemId);
      }
      const match = path.match(/^\/api\/projects\/([^/]+)$/);
      if (match) {
        const id = decodeURIComponent(match[1]);
        if (!isId(id)) return fail("Bad project id.");
        if (method === "GET") {
          const found = await getProject(env, id);
          return found ? json(found) : fail("No such project.", 404);
        }
        if (method === "PUT") return await saveProject(request, env, ctx, id, url.searchParams.has("create"));
        if (method === "DELETE") return await deleteProject(env, id);
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

  async scheduled(controller, env) {
    await deleteOldOriginals(env.MEDIA, controller.scheduledTime);
  },
} satisfies ExportedHandler<Env>;
