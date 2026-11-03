/**
 * process-media.ts — the processing in the cloud: web copies of every image
 * uploaded through the admin, made exactly as `npm run work:images` makes them
 * (the same `encode` from media.ts: MozJPEG at 85, stepping down only to keep a
 * copy under 1 MB, 3000 / 1500 / 1000px, never enlarged).
 *
 * Run by .github/workflows/process-media.yml every few minutes. It talks to
 * storage through the site's Worker (/api/pipeline/*, see worker/site.ts),
 * proving who it is with a token GitHub signs for the run, so no storage key
 * or password lives anywhere. One item at a time: read the queue, fetch the
 * original, make the three copies, upload them, record the result.
 *
 * Videos are not touched here yet: their compression waits on the owner's
 * HandBrake presets, and their previews on the Preview Cutter.
 *
 * Locally, against `wrangler dev` with DEV_BYPASS (no GitHub token needed):
 *   PIPELINE_URL=http://localhost:8788 PIPELINE_DEV=1 node --experimental-strip-types scripts/process-media.ts
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { ReadableStream } from "node:stream/web";
import { type Copies, type ItemStatus, keys, type QueueEntry } from "../admin/shared.ts";
import { encode, LONGEST_SIDE, mb } from "./media.ts";

const BASE = process.env.PIPELINE_URL ?? "https://rh.rh-3b6.workers.dev";
const SIZES: [keyof Copies, number][] = [
  ["full", LONGEST_SIDE],
  ["mid", 1500],
  ["canvas", 1000],
];

// GitHub's token for this run, refreshed every few minutes (they're short-lived).
let token: { value: string; at: number } | null = null;
async function auth() {
  if (process.env.PIPELINE_DEV) return "dev";
  if (token && Date.now() - token.at < 4 * 60_000) return token.value;
  const url = process.env.ACTIONS_ID_TOKEN_REQUEST_URL;
  const request = process.env.ACTIONS_ID_TOKEN_REQUEST_TOKEN;
  if (!url || !request) throw new Error("No GitHub token: run this from the workflow (id-token: write).");
  const response = await fetch(`${url}&audience=rh-pipeline`, { headers: { authorization: `bearer ${request}` } });
  if (!response.ok) throw new Error(`GitHub token: ${response.status}`);
  token = { value: ((await response.json()) as { value: string }).value, at: Date.now() };
  return token.value;
}

async function call(method: string, route: string, body?: string | Buffer, contentType?: string) {
  const headers: Record<string, string> = { authorization: `Bearer ${await auth()}` };
  if (contentType) headers["content-type"] = contentType;
  const response = await fetch(`${BASE}${route}`, { method, headers, body });
  if (!response.ok) throw new Error(`${method} ${route}: ${response.status} ${await response.text()}`);
  return response;
}

const report = (entry: QueueEntry, status: Omit<ItemStatus, "at">) =>
  call("POST", "/api/pipeline/status", JSON.stringify({ project: entry.project, item: entry.item, status }), "application/json");

async function processImage(entry: QueueEntry, dir: string) {
  const src = path.join(dir, path.basename(entry.original));
  // Streamed to disk: some originals run to hundreds of megabytes.
  const response = await call("GET", `/api/pipeline/original?key=${encodeURIComponent(entry.original)}`);
  await pipeline(Readable.fromWeb(response.body as ReadableStream), fs.createWriteStream(src));

  const copies = {} as Copies;
  let size = { width: 0, height: 0 };
  for (const [name, side] of SIZES) {
    const out = path.join(dir, `${name}.jpg`);
    const result = await encode(src, out, side);
    if (name === "full") size = { width: result.width, height: result.height };
    const key = keys.web(entry.project, name, entry.item);
    await call("PUT", `/api/pipeline/copy?key=${encodeURIComponent(key)}`, fs.readFileSync(out), "image/jpeg");
    copies[name] = key;
    console.log(`  ${name} ${result.width}×${result.height} ${mb(result.size)} q${result.quality}`);
  }
  await report(entry, { state: "done", copies, ...size });
}

const queue = (await (await call("GET", "/api/pipeline/queue")).json()) as QueueEntry[];
console.log(`${queue.length} image${queue.length === 1 ? "" : "s"} queued`);

for (const entry of queue) {
  console.log(`${entry.project} / ${entry.file}`);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rh-"));
  try {
    await report(entry, { state: "processing" });
    await processImage(entry, dir);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`  failed: ${message}`);
    await report(entry, { state: "failed", message: message.slice(0, 300) }).catch(() => {});
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}
