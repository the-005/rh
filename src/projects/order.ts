/**
 * The order the projects were dragged into on the admin's list (the owner,
 * 4 Nov: "that order will decide how they show up on the index page"), read
 * from storage through the site's Worker (/api/order, worker/site.ts).
 *
 * Fetched once, as the site loads, so it's usually in by the time the index
 * opens. Until it arrives, or when it can't be read (`npm run dev` has no
 * Worker), the manifest's order stands. Projects the order doesn't name keep
 * their manifest order after the ones it does.
 */

let order: string[] | null = null;

export const orderReady: Promise<void> = fetch("/api/order")
  .then((r) => (r.ok ? r.json() : null))
  .then((data: { order?: unknown } | null) => {
    if (Array.isArray(data?.order)) order = data.order.filter((id): id is string => typeof id === "string");
  })
  .catch(() => {});

export function inAdminOrder<T extends { id: string }>(projects: readonly T[]): T[] {
  if (!order?.length) return [...projects];
  const rank = new Map(order.map((id, i) => [id, i]));
  const at = (p: T) => rank.get(p.id) ?? order!.length + projects.indexOf(p);
  return [...projects].sort((a, b) => at(a) - at(b));
}
