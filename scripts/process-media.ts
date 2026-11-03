/**
 * process-media.ts — the processing in the cloud, for everything uploaded
 * through the admin:
 * - images: three web copies, made exactly as `npm run work:images` makes them
 *   (the same `encode` from media.ts: MozJPEG at 85, stepping down only to keep
 *   a copy under 1 MB, 3000 / 1500 / 1000px, never enlarged);
 * - previews: the pieces picked in the Preview Cutter, joined and compressed
 *   the same way (processPreview);
 * - videos: compressed with HandBrake the way the owner does it by hand
 *   (4 Nov): the "Fast 2160p60 4K HEVC" preset with cropping set to none,
 *   capped at 2560 × 1440 ("2K", the cap turned for portrait videos: the
 *   preset alone squeezes a portrait 4K video into 2160 × 2160 with stretched
 *   pixels), plus "web optimized" so playback can start before the whole file
 *   has arrived (it only moves the file's index to the front).
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
import {
  type Copies,
  HANDBRAKE_PRESET,
  type ItemStatus,
  isVideo,
  keys,
  type QueueEntry,
  VIDEO_LONG_SIDE,
  VIDEO_SHORT_SIDE,
} from "../admin/shared.ts";
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
  call(
    "POST",
    "/api/pipeline/status",
    JSON.stringify({ project: entry.project, item: entry.item, preview: entry.type === "preview", status }),
    "application/json"
  );

// The original, streamed to disk: some run to hundreds of MB, videos to GBs.
async function download(entry: QueueEntry, dir: string) {
  const src = path.join(dir, path.basename(entry.original));
  const response = await call("GET", `/api/pipeline/original?key=${encodeURIComponent(entry.original)}`);
  await pipeline(Readable.fromWeb(response.body as ReadableStream), fs.createWriteStream(src));
  return src;
}

// Runs a program to the end and returns what it printed; fails with the last
// of what it printed to its error stream.
function run(program: string, args: string[]) {
  return new Promise<string>((resolve, reject) => {
    const child = spawn(program, args);
    let out = "";
    let err = "";
    child.stdout.on("data", (chunk: Buffer) => {
      out += chunk.toString();
    });
    child.stderr.on("data", (chunk: Buffer) => {
      err = (err + chunk.toString()).slice(-4000);
    });
    child.on("error", reject);
    child.on("close", (code) => (code === 0 ? resolve(out) : reject(new Error(`${program} exited ${code}: ${err.slice(-300)}`))));
  });
}

// A video's size as it's shown: phones often store portrait video landscape,
// with a rotation tag.
async function shownSize(file: string) {
  const probe = JSON.parse(
    await run("ffprobe", [
      "-v",
      "error",
      "-select_streams",
      "v:0",
      "-show_entries",
      "stream=width,height:stream_side_data=rotation:stream_tags=rotate",
      "-of",
      "json",
      file,
    ])
  ) as {
    streams: { width: number; height: number; side_data_list?: { rotation?: number }[]; tags?: { rotate?: string } }[];
  };
  const stream = probe.streams[0];
  const rotation = stream.side_data_list?.find((d) => d.rotation !== undefined)?.rotation ?? Number(stream.tags?.rotate ?? 0);
  const turned = Math.abs(rotation) % 180 === 90;
  return turned ? { width: stream.height, height: stream.width } : { width: stream.width, height: stream.height };
}

// HandBrake with the owner's settings, capped at 2K and turned to suit the
// video (see the top of this file).
async function compress(src: string, out: string) {
  const source = await shownSize(src);
  const portrait = source.height > source.width;
  const [maxWidth, maxHeight] = portrait ? [VIDEO_SHORT_SIDE, VIDEO_LONG_SIDE] : [VIDEO_LONG_SIDE, VIDEO_SHORT_SIDE];
  await run(HANDBRAKE, [
    "--preset",
    HANDBRAKE_PRESET,
    "--crop",
    "0:0:0:0",
    "--maxWidth",
    String(maxWidth),
    "--maxHeight",
    String(maxHeight),
    "--optimize",
    "-i",
    src,
    "-o",
    out,
  ]);
  return shownSize(out);
}

// A finished video up to storage, in pieces under the Worker's request limit.
async function uploadVideo(file: string, key: string) {
  const size = fs.statSync(file).size;
  const at = `/api/pipeline/upload?key=${encodeURIComponent(key)}`;
  const { uploadId } = (await (await call("POST", at)).json()) as { uploadId: string };
  const parts = [];
  const handle = fs.openSync(file, "r");
  try {
    for (let n = 1, offset = 0; offset < size; n++, offset += PART) {
      const piece = Buffer.alloc(Math.min(PART, size - offset));
      fs.readSync(handle, piece, 0, piece.length, offset);
      const response = await call("PUT", `${at}&uploadId=${encodeURIComponent(uploadId)}&part=${n}`, piece);
      parts.push(await response.json());
    }
  } finally {
    fs.closeSync(handle);
  }
  await call(
    "POST",
    `/api/pipeline/upload/complete?key=${encodeURIComponent(key)}&uploadId=${encodeURIComponent(uploadId)}`,
    JSON.stringify({ parts }),
    "application/json"
  );
}

async function processVideo(entry: QueueEntry, dir: string) {
  const src = await download(entry, dir);
  const out = path.join(dir, "video.mp4");
  const started = Date.now();
  const { width, height } = await compress(src, out);
  console.log(
    `  ${width}×${height} ${mb(fs.statSync(src).size)} → ${mb(fs.statSync(out).size)} in ${Math.round((Date.now() - started) / 1000)}s`
  );
  const key = keys.video(entry.project, entry.item);
  await uploadVideo(out, key);
  await report(entry, { state: "done", video: key, width, height });
}

// A preview, as the owner decided (2 Nov): the pieces picked in the Preview
// Cutter cut from the original and joined without loss (frame-exact, so a
// lossless intermediate rather than a stream copy, which can only cut on
// keyframes), then one HandBrake encode with the same settings as the video.
// No sound: previews loop silently.
async function processPreview(entry: QueueEntry, dir: string) {
  const pieces = entry.pieces ?? [];
  if (!pieces.length) throw new Error("No pieces saved.");
  const src = await download(entry, dir);
  const joined = path.join(dir, "joined.mkv");
  const out = path.join(dir, "preview.mp4");
  const started = Date.now();
  const trims = pieces.map((p, i) => `[0:v]trim=start=${p.s}:end=${p.e},setpts=PTS-STARTPTS[p${i}]`);
  const filter = `${trims.join(";")};${pieces.map((_, i) => `[p${i}]`).join("")}concat=n=${pieces.length}:v=1:a=0[out]`;
  await run("ffmpeg", [
    "-y",
    "-v",
    "error",
    "-i",
    src,
    "-filter_complex",
    filter,
    "-map",
    "[out]",
    "-an",
    "-c:v",
    "libx264",
    "-qp",
    "0",
    "-preset",
    "ultrafast",
    joined,
  ]);
  const { width, height } = await compress(joined, out);
  const seconds = pieces.reduce((t, p) => t + p.e - p.s, 0);
  console.log(
    `  preview ${seconds.toFixed(1)}s from ${pieces.length} pieces, ${width}×${height} ${mb(fs.statSync(out).size)} in ${Math.round((Date.now() - started) / 1000)}s`
  );
  const key = keys.preview(entry.project, entry.item);
  await uploadVideo(out, key);
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
  console.log(`${entry.project} / ${entry.file}${entry.type === "preview" ? " (preview)" : ""}`);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rh-"));
  try {
    await report(entry, { state: "processing" });
    // Entries from before videos were processed carry no type.
    const type = entry.type ?? (isVideo(entry.file) ? "video" : "image");
    await (type === "preview"
      ? processPreview(entry, dir)
      : type === "video"
        ? processVideo(entry, dir)
        : processImage(entry, dir));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`  failed: ${message}`);
    await report(entry, { state: "failed", message: message.slice(0, 300) }).catch(() => {});
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}
