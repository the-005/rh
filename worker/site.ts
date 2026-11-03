/**
 * The site's Worker (rh). The site itself is static files (dist/), served by
 * Cloudflare before this runs; only /api/* and /media/* reach it
 * (`run_worker_first` in wrangler.jsonc).
 *
 * /api/site is what the site shows (admin/site-data.ts), read as it loads, and
 * /media/* the files of it that live in storage.
 *
 * /api/pipeline/* is the door the processing comes through
 * (scripts/process-media.ts, run by .github/workflows/process-media.yml). It
 * holds no password: each call carries a token GitHub signs for that workflow
 * run, and only a run of that workflow, from this repository's main branch,
 * gets in. Through it the processing reads what's queued, reads an original,
 * writes the web copies (or a compressed video) and records how each item went.
 */

import { createRemoteJWKSet, jwtVerify } from "jose";
import { type ItemStatus, keys, PROCESS_PREFIX, previewStatusId, type QueueEntry, type Status } from "../admin/shared.ts";
import { publishSite, SITE_KEY, type SiteData } from "../admin/site-data.ts";

interface Env {
  ASSETS: Fetcher;
  MEDIA: R2Bucket;
  // Local development only (.dev.vars), and only honoured on localhost.
  DEV_BYPASS?: string;
}

const ISSUER = "https://token.actions.githubusercontent.com";
const PIPELINE_AUDIENCE = "rh-pipeline";
const WORKFLOW = "the-005/rh/.github/workflows/process-media.yml@refs/heads/main";

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json" } });

let jwks: ReturnType<typeof createRemoteJWKSet> | undefined;

async function fromPipeline(request: Request, env: Env) {
  const host = new URL(request.url).hostname;
  if (env.DEV_BYPASS === "1" && (host === "localhost" || host === "127.0.0.1")) return true;
  const token = request.headers.get("authorization")?.replace(/^Bearer /i, "");
  if (!token) return false;
  jwks ??= createRemoteJWKSet(new URL(`${ISSUER}/.well-known/jwks`));
  try {
    const { payload } = await jwtVerify(token, jwks, { issuer: ISSUER, audience: PIPELINE_AUDIENCE });
    return payload.repository === "the-005/rh" && payload.workflow_ref === WORKFLOW;
  } catch {
    return false;
  }
}

async function pipeline(request: Request, env: Env, url: URL) {
  if (!(await fromPipeline(request, env))) return json({ error: "Not allowed." }, 403);
  const key = url.searchParams.get("key") ?? "";

  if (url.pathname === "/api/pipeline/queue" && request.method === "GET") {
    const listed = await env.MEDIA.list({ prefix: PROCESS_PREFIX, limit: 100 });
    const entries = await Promise.all(
      listed.objects.map(async (o) => (await (await env.MEDIA.get(o.key))?.json()) as QueueEntry | null)
    );
    return json(entries.filter((e) => e !== null));
  }

  if (url.pathname === "/api/pipeline/original" && request.method === "GET") {
    if (!/^projects\/[\w-]+\/originals\/[\w.-]+$/.test(key)) return json({ error: "Bad key." }, 400);
    const object = await env.MEDIA.get(key);
    if (!object) return json({ error: "Not found." }, 404);
    return new Response(object.body, { headers: { "content-length": String(object.size) } });
  }

  if (url.pathname === "/api/pipeline/copy" && request.method === "PUT") {
    if (!/^projects\/[\w-]+\/web\/(full|mid|canvas)\/[\w-]+\.jpg$/.test(key) || !request.body)
      return json({ error: "Bad key." }, 400);
    await env.MEDIA.put(key, request.body, { httpMetadata: { contentType: "image/jpeg" } });
    return json({ ok: true });
  }

  // A compressed video, which can run to hundreds of MB: uploaded in pieces
  // (R2 multipart), each under the Worker's request size limit.
  if (url.pathname.startsWith("/api/pipeline/upload")) {
    if (!/^projects\/[\w-]+\/web\/(video|preview)\/[\w-]+\.mp4$/.test(key)) return json({ error: "Bad key." }, 400);
    if (url.pathname === "/api/pipeline/upload" && request.method === "POST") {
      const upload = await env.MEDIA.createMultipartUpload(key, { httpMetadata: { contentType: "video/mp4" } });
      return json({ uploadId: upload.uploadId });
    }
    const uploadId = url.searchParams.get("uploadId");
    if (!uploadId) return json({ error: "Bad upload." }, 400);
    const upload = env.MEDIA.resumeMultipartUpload(key, uploadId);
    if (url.pathname === "/api/pipeline/upload" && request.method === "PUT") {
      const part = Number(url.searchParams.get("part"));
      if (!Number.isInteger(part) || part < 1 || part > 10000 || !request.body) return json({ error: "Bad part." }, 400);
      return json(await upload.uploadPart(part, request.body));
    }
    if (url.pathname === "/api/pipeline/upload/complete" && request.method === "POST") {
      const { parts } = (await request.json()) as { parts: R2UploadedPart[] };
      await upload.complete(parts);
      return json({ ok: true });
    }
  }

  // How an item went. Once it's done (or failed) it leaves the queue. The
  // processing runs one item at a time, so status.json has a single writer.
  if (url.pathname === "/api/pipeline/status" && request.method === "POST") {
    const body = (await request.json()) as { project: string; item: string; preview?: boolean; status: ItemStatus };
    if (!/^[\w-]+$/.test(body.project) || !/^[\w-]+$/.test(body.item)) return json({ error: "Bad item." }, 400);
    const statusKey = keys.status(body.project);
    const status = ((await (await env.MEDIA.get(statusKey))?.json()) as Status | null) ?? {};
    // A preview's status sits beside its video's, under its own id.
    status[body.preview ? previewStatusId(body.item) : body.item] = { ...body.status, at: new Date().toISOString() };
    await env.MEDIA.put(statusKey, JSON.stringify(status), { httpMetadata: { contentType: "application/json" } });
    if (body.status.state !== "processing") {
      await env.MEDIA.delete(body.preview ? keys.processPreview(body.project, body.item) : keys.process(body.project, body.item));
      // A finished item may be new on the site.
      await publishSite(env.MEDIA);
    }
    return json({ ok: true });
  }

  return json({ error: "Not found." }, 404);
}

// What the site shows (site.json, see admin/site-data.ts): read when the site
// loads. Built here if it's never been written.
async function site(env: Env): Promise<SiteData> {
  const stored = (await (await env.MEDIA.get(SITE_KEY))?.json()) as SiteData | null;
  return stored ?? publishSite(env.MEDIA);
}

// The projects whose files the site may serve, kept for half a minute per
// Worker instance so files don't each read site.json.
let shown: { ids: Set<string>; at: number } | null = null;
async function shownProjects(env: Env) {
  if (!shown || Date.now() - shown.at > 30_000) {
    const data = await site(env);
    shown = { ids: new Set(data.media.map((m) => m.project)), at: Date.now() };
  }
  return shown.ids;
}

// A file from storage: only web copies, videos and previews (never an
// original), and only of projects shown on the site. Ranges, so videos seek.
async function media(request: Request, env: Env, key: string) {
  const match = key.match(/^projects\/([\w-]+)\/web\/(full|mid|canvas|video|preview)\/[\w-]+\.(jpg|mp4)$/);
  if (!match || !(await shownProjects(env)).has(match[1])) return new Response("Not found", { status: 404 });
  const object = await env.MEDIA.get(key, { range: request.headers, onlyIf: request.headers });
  if (!object) return new Response("Not found", { status: 404 });
  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set("etag", object.httpEtag);
  headers.set("cache-control", "public, max-age=86400");
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
    const url = new URL(request.url);
    if (url.pathname === "/api/site" && request.method === "GET")
      return new Response(JSON.stringify(await site(env)), {
        headers: { "content-type": "application/json", "cache-control": "public, max-age=30" },
      });
    if (url.pathname.startsWith("/media/") && request.method === "GET")
      return media(request, env, decodeURIComponent(url.pathname.slice("/media/".length)));
    if (url.pathname.startsWith("/api/pipeline/")) {
      try {
        return await pipeline(request, env, url);
      } catch (error) {
        return json({ error: error instanceof Error ? error.message : String(error) }, 500);
      }
    }
    return env.ASSETS.fetch(request);
  },
} satisfies ExportedHandler<Env>;
