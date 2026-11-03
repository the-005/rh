/**
 * Uploads straight to storage, in 10 MB pieces (R2 multipart), two files at a
 * time. Pieces keep every request under the Worker's size limit, so a video of
 * several GB uploads like a photo, and a piece that fails is retried on its
 * own rather than starting the file again.
 */

import { call } from "./api.ts";

// R2 wants every piece but the last the same size, and at least 5 MB.
const PART = 10 * 1024 * 1024;
const AT_ONCE = 2;
const TRIES = 3;

type Part = { partNumber: number; etag: string };
type Job = { key: string; file: File; progress: (fraction: number) => void; done: () => void; failed: (e: Error) => void };

const waiting: Job[] = [];
let running = 0;

export function upload(key: string, file: File, progress: (fraction: number) => void) {
  return new Promise<void>((done, failed) => {
    waiting.push({ key, file, progress, done, failed });
    next();
  });
}

function next() {
  while (running < AT_ONCE && waiting.length) {
    const job = waiting.shift() as Job;
    running++;
    run(job)
      .then(job.done, job.failed)
      .finally(() => {
        running--;
        next();
      });
  }
}

async function run({ key, file, progress }: Job) {
  if (file.size === 0) throw new Error("The file is empty.");
  const { uploadId } = await call<{ uploadId: string }>("POST", "/api/uploads", {
    key,
    contentType: file.type,
  });
  const at = `/api/uploads?key=${encodeURIComponent(key)}&uploadId=${encodeURIComponent(uploadId)}`;
  try {
    const parts: Part[] = [];
    const count = Math.ceil(file.size / PART);
    for (let n = 1; n <= count; n++) {
      const start = (n - 1) * PART;
      const piece = file.slice(start, start + PART);
      parts.push(await retry(() => send(`${at}&part=${n}`, piece, (sent) => progress((start + sent) / file.size))));
    }
    await call("POST", "/api/uploads/complete", { key, uploadId, parts });
    progress(1);
  } catch (error) {
    fetch(at, { method: "DELETE" }).catch(() => {});
    throw error;
  }
}

async function retry<T>(attempt: () => Promise<T>) {
  for (let i = 1; ; i++) {
    try {
      return await attempt();
    } catch (error) {
      if (i >= TRIES) throw error;
      await new Promise((r) => setTimeout(r, 1000 * i));
    }
  }
}

// One piece, by XMLHttpRequest because fetch can't report upload progress.
function send(url: string, piece: Blob, progress: (sent: number) => void) {
  return new Promise<Part>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", url);
    xhr.upload.onprogress = (e) => progress(e.loaded);
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) resolve(JSON.parse(xhr.responseText) as Part);
      else reject(new Error(`Upload failed (${xhr.status})`));
    };
    xhr.onerror = () => reject(new Error("Upload failed (network)"));
    xhr.send(piece);
  });
}
