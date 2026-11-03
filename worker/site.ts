/**
 * The site's Worker (rh). The site itself is static files (dist/), served by
 * Cloudflare before this runs; only /api/* reaches it (`run_worker_first` in
 * wrangler.jsonc).
 *
 * /api/pipeline/* is the door the processing comes through
 * (scripts/process-media.ts, run by .github/workflows/process-media.yml). It
 * holds no password: each call carries a token GitHub signs for that workflow
 * run, and only a run of that workflow, from this repository's main branch,
 * gets in. Through it the processing reads what's queued, reads an original,
 * writes the web copies (or a compressed video) and records how each item went.
 */

import { createRemoteJWKSet, jwtVerify } from "jose";
import { type ItemStatus, keys, PROCESS_PREFIX, type QueueEntry, type Status } from "../admin/shared.ts";

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
    if (!/^projects\/[\w-]+\/web\/video\/[\w-]+\.mp4$/.test(key)) return json({ error: "Bad key." }, 400);
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
    const body = (await request.json()) as { project: string; item: string; status: ItemStatus };
    if (!/^[\w-]+$/.test(body.project) || !/^[\w-]+$/.test(body.item)) return json({ error: "Bad item." }, 400);
    const statusKey = keys.status(body.project);
    const status = ((await (await env.MEDIA.get(statusKey))?.json()) as Status | null) ?? {};
    status[body.item] = { ...body.status, at: new Date().toISOString() };
    await env.MEDIA.put(statusKey, JSON.stringify(status), { httpMetadata: { contentType: "application/json" } });
    if (body.status.state !== "processing") await env.MEDIA.delete(keys.process(body.project, body.item));
    return json({ ok: true });
  }

  return json({ error: "Not found." }, 404);
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
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
