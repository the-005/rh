/**
 * process-media.ts — the processing in the cloud, for everything uploaded
 * through the admin:
 * - images: three web copies, made exactly as `npm run work:images` makes them
 *   (the same `encode` from media.ts: MozJPEG at 85, stepping down only to keep
 *   a copy under 1 MB, 3000 / 1500 / 1000px, never enlarged);
 * - videos: compressed with HandBrake the way the owner does it by hand
 *   (4 Nov): the "Fast 2160p60 4K HEVC" preset with cropping set to none,
 *   nothing else changed, plus "web optimized" so playback can start before the
 *   whole file has arrived (it only moves the file's index to the front).
 *
 * Run by .github/workflows/process-media.yml every few minutes. It talks to
 * storage through the site's Worker (/api/pipeline/*, see worker/site.ts),
 * proving who it is with a token GitHub signs for the run, so no storage key
 * or password lives anywhere. One item at a time: read the queue, fetch the
 * original, make the copies, upload them, record the result. Video previews
 * are the Preview Cutter's (a separate queue).
 *
 * Locally, against `wrangler dev` with DEV_BYPASS (no GitHub token needed):
 *   PIPELINE_URL=http://localhost:8788 PIPELINE_DEV=1 node --experimental-strip-types scripts/process-media.ts
 * HANDBRAKE_CLI points at another HandBrakeCLI (or a stand-in) if needed.
 */

import { spawn } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { ReadableStream } from "node:stream/web";
import { type Copies, HANDBRAKE_PRESET, type ItemStatus, isVideo, keys, type QueueEntry } from "../admin/shared.ts";
import { encode, LONGEST_SIDE, mb } from "./media.ts";

const BASE = process.env.PIPELINE_URL ?? "https://rh.rh-3b6.workers.dev";
const HANDBRAKE = process.env.HANDBRAKE_CLI ?? "HandBrakeCLI";
// Compressed videos go up in pieces under the Worker's 100 MB request limit;
// R2 wants every piece but the last the same size.
const PART = Number(process.env.PIPELINE_PART_MB ?? 50) * 1024 * 1024;
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

// The original, streamed to disk: some run to hundreds of MB, videos to GBs.
async function download(entry: QueueEntry, dir: string) {
  const src = path.join(dir, path.basename(entry.original));
  const response = await call("GET", `/api/pipeline/original?key=${encodeURIComponent(entry.original)}`);
  await pipeline(Readable.fromWeb(response.body as ReadableStream), fs.createWriteStream(src));
  return src;
}

// Runs a program to the end; fails with the last of what it printed.
function run(program: string, args: string[]) {
  return new Promise<string>((resolve, reject) => {
    const child = spawn(program, args);
    let out = "";
    const keep = (chunk: Buffer) => {
      out = (out + chunk.toString()).slice(-4000);
    };
    child.stdout.on("data", keep);
    child.stderr.on("data", keep);
    child.on("error", reject);
    child.on("close", (code) => (code === 0 ? resolve(out) : reject(new Error(`${program} exited ${code}: ${out.slice(-300)}`))));
  });
}

async function processVideo(entry: QueueEntry, dir: string) {
  const src = await download(entry, dir);
  const out = path.join(dir, "video.mp4");
  const started = Date.now();
  await run(HANDBRAKE, ["--preset", HANDBRAKE_PRESET, "--crop", "0:0:0:0", "--optimize", "-i", src, "-o", out]);
  const probe = await run("ffprobe", [
    "-v",
    "error",
    "-select_streams",
    "v:0",
    "-show_entries",
    "stream=width,height",
    "-of",
    "csv=p=0",
    out,
  ]);
  const [width, height] = probe.trim().split(",").map(Number);
  const size = fs.statSync(out).size;
  console.log(`  ${width}×${height} ${mb(fs.statSync(src).size)} → ${mb(size)} in ${Math.round((Date.now() - started) / 1000)}s`);

  const key = keys.video(entry.project, entry.item);
  const at = `/api/pipeline/upload?key=${encodeURIComponent(key)}`;
  const { uploadId } = (await (await call("POST", at)).json()) as { uploadId: string };
  const parts = [];
  const file = fs.openSync(out, "r");
  try {
    for (let n = 1, offset = 0; offset < size; n++, offset += PART) {
      const piece = Buffer.alloc(Math.min(PART, size - offset));
      fs.readSync(file, piece, 0, piece.length, offset);
      const response = await call("PUT", `${at}&uploadId=${encodeURIComponent(uploadId)}&part=${n}`, piece);
      parts.push(await response.json());
    }
  } finally {
    fs.closeSync(file);
  }
  await call(
    "POST",
    `/api/pipeline/upload/complete?key=${encodeURIComponent(key)}&uploadId=${encodeURIComponent(uploadId)}`,
    JSON.stringify({ parts }),
    "application/json"
  );
  await report(entry, { state: "done", video: key, width, height });
}

async function processImage(entry: QueueEntry, dir: string) {
  const src = await download(entry, dir);

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
console.log(`${queue.length} queued`);

for (const entry of queue) {
  console.log(`${entry.project} / ${entry.file}`);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rh-"));
  try {
    await report(entry, { state: "processing" });
    // Entries from before videos were processed carry no type.
    const video = entry.type ? entry.type === "video" : isVideo(entry.file);
    await (video ? processVideo(entry, dir) : processImage(entry, dir));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`  failed: ${message}`);
    await report(entry, { state: "failed", message: message.slice(0, 300) }).catch(() => {});
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}
