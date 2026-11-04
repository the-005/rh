/**
 * originals.ts — originals leave storage ORIGINALS_KEEP_DAYS after they were
 * uploaded (the owner, 5 Nov, to keep storage small). Run once a day by the
 * admin Worker's schedule (`triggers` in admin/wrangler.jsonc).
 *
 * An original goes once it's that old and nothing still needs it: its item is
 * done and not queued again, or it belongs to no saved item (an upload that was
 * never saved). One whose item is still waiting, processing or failed stays, so
 * it can still be made. The item keeps the original's key in project.json.
 */

import { keys, ORIGINALS_KEEP_DAYS, PROCESS_PREFIX, type Project, type Status } from "./shared.ts";

const DAY_MS = 86_400_000;

// Which of one project's originals can go. `queued` holds "<project>__<item>"
// for every image or video waiting in the processing queue.
export function expired(
  id: string,
  originals: { key: string; uploaded: Date }[],
  project: Project | null,
  status: Status,
  queued: Set<string>,
  now: number
) {
  const owners = new Map((project?.items ?? []).map((i) => [i.original, i]));
  return originals
    .filter(({ key, uploaded }) => {
      if (now - uploaded.getTime() < ORIGINALS_KEEP_DAYS * DAY_MS) return false;
      const item = owners.get(key);
      if (!item) return true;
      return status[item.id]?.state === "done" && !queued.has(`${id}__${item.id}`);
    })
    .map((o) => o.key);
}

async function listAll(bucket: R2Bucket, options: R2ListOptions) {
  const objects: R2Object[] = [];
  const prefixes: string[] = [];
  let cursor: string | undefined;
  do {
    const listed = await bucket.list({ ...options, cursor, limit: 1000 });
    objects.push(...listed.objects);
    prefixes.push(...listed.delimitedPrefixes);
    cursor = listed.truncated ? listed.cursor : undefined;
  } while (cursor);
  return { objects, prefixes };
}

async function readJson<T>(bucket: R2Bucket, key: string): Promise<T | null> {
  const object = await bucket.get(key);
  return object ? ((await object.json()) as T) : null;
}

// Every project folder in storage, saved or not, so uploads to a project that
// was never saved go too.
export async function deleteOldOriginals(bucket: R2Bucket, now: number) {
  const queued = new Set(
    (await listAll(bucket, { prefix: PROCESS_PREFIX })).objects.map((o) => o.key.slice(PROCESS_PREFIX.length, -".json".length))
  );
  const { prefixes } = await listAll(bucket, { prefix: "projects/", delimiter: "/" });
  const gone: string[] = [];
  for (const folder of prefixes) {
    const id = folder.slice("projects/".length, -1);
    const { objects } = await listAll(bucket, { prefix: `${folder}originals/` });
    if (!objects.some((o) => now - o.uploaded.getTime() >= ORIGINALS_KEEP_DAYS * DAY_MS)) continue;
    const [project, status] = await Promise.all([
      readJson<Project>(bucket, keys.project(id)),
      readJson<Status>(bucket, keys.status(id)),
    ]);
    gone.push(...expired(id, objects, project, status ?? {}, queued, now));
  }
  for (let i = 0; i < gone.length; i += 1000) await bucket.delete(gone.slice(i, i + 1000));
  console.log(`${gone.length} originals deleted`, gone);
  return gone;
}
