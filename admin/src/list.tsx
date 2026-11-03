import * as React from "react";
import { Link, useLocation } from "wouter";
import { api, mediaUrl, type Summary } from "./api.ts";
import { importSite } from "./import.ts";
import "./material.ts";

// Every project, in the site's order, and the way to a new one. The first time
// the admin opens, storage is empty: it brings the site's projects in first.
//
// The order is dragged by the handle on each card (or moved with the arrow
// keys on it), and saved as soon as a card is let go: it's the order the
// site's index lists the projects in (the owner, 4 Nov; through the site's
// /api/order, see worker/site.ts).
export function List() {
  const [, navigate] = useLocation();
  const [projects, setProjects] = React.useState<Summary[] | null>(null);
  const [error, setError] = React.useState("");
  const [importing, setImporting] = React.useState("");
  const [dragging, setDragging] = React.useState<string | null>(null);
  const [orderNote, setOrderNote] = React.useState("");
  const gridRef = React.useRef<HTMLUListElement>(null);
  const pointerY = React.useRef(0);
  // The order when a drag began, to save only when it changed.
  const startOrder = React.useRef("");

  async function saveOrder(list: Summary[]) {
    setOrderNote("Saving the order…");
    try {
      await api.order(list.map((p) => p.id));
      setOrderNote("Order saved. The site's index follows it within a minute.");
    } catch (e) {
      setOrderNote(`Couldn't save the order: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  const move = (id: string, to: number) => {
    if (!projects) return projects;
    const from = projects.findIndex((p) => p.id === id);
    if (from < 0 || to === from || to < 0 || to >= projects.length) return projects;
    const next = [...projects];
    const [project] = next.splice(from, 1);
    next.splice(to, 0, project);
    setProjects(next);
    return next;
  };

  // Dragging: the card goes to the place of the card nearest the pointer.
  const onDragMove = (e: React.PointerEvent) => {
    pointerY.current = e.clientY;
    if (!dragging || !gridRef.current) return;
    const cards = [...gridRef.current.children];
    let to = -1;
    let best = Number.POSITIVE_INFINITY;
    cards.forEach((card, i) => {
      const box = card.getBoundingClientRect();
      const d = Math.hypot(e.clientX - (box.left + box.width / 2), e.clientY - (box.top + box.height / 2));
      if (d < best) {
        best = d;
        to = i;
      }
    });
    if (to >= 0) move(dragging, to);
  };

  // Near the window's top or bottom, a drag scrolls the page.
  React.useEffect(() => {
    if (!dragging) return;
    let frame = 0;
    const tick = () => {
      const y = pointerY.current;
      const step = y > window.innerHeight - 120 ? 14 : y < 140 ? -14 : 0;
      if (step) window.scrollBy(0, step);
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [dragging]);

  async function load() {
    try {
      const found = await api.projects();
      setProjects(found);
      return found;
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      return null;
    }
  }

  async function bringIn() {
    setError("");
    try {
      await importSite(setImporting);
      setImporting("");
      await load();
    } catch (e) {
      setImporting("");
      setError(`Bringing the projects in stopped: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  React.useEffect(() => {
    load().then((found) => {
      if (found && found.length === 0 && !startedImport) {
        startedImport = true;
        bringIn();
      }
    });
  }, []);

  return (
    <div className="list">
      <header className="list-head">
        <h1 className="md-typescale-headline-medium">Projects</h1>
        <md-filled-button onClick={() => navigate("/new")}>
          <md-icon slot="icon">add</md-icon>
          New project
        </md-filled-button>
      </header>
      {importing && (
        <div className="notice md-typescale-body-medium">
          {importing}…
          <md-linear-progress indeterminate />
        </div>
      )}
      {error && (
        <p className="notice md-typescale-body-medium">
          {error} <md-text-button onClick={bringIn}>Try again</md-text-button>
        </p>
      )}
      {!projects && !error && <p className="notice md-typescale-body-medium">Loading…</p>}
      {projects && projects.length > 1 && (
        <p className="hint md-typescale-body-medium">
          {orderNote || (
            <>
              Drag <md-icon>drag_indicator</md-icon> up or down to change the order of the projects on the site's index.
            </>
          )}
        </p>
      )}
      <ul className="projects" ref={gridRef} onPointerMove={onDragMove}>
        {projects?.map((p, index) => (
          <li key={p.id} className={dragging === p.id ? "dragging" : undefined}>
            <md-icon-button
              className="card-handle"
              aria-label={`Move ${p.name} (arrow keys)`}
              onPointerDown={(e: React.PointerEvent<HTMLElement>) => {
                e.preventDefault();
                e.currentTarget.setPointerCapture(e.pointerId);
                pointerY.current = e.clientY;
                startOrder.current = (projects ?? []).map((x) => x.id).join("/");
                setDragging(p.id);
              }}
              onPointerUp={() => {
                setDragging(null);
                if (projects && projects.map((x) => x.id).join("/") !== startOrder.current) saveOrder(projects);
              }}
              onPointerCancel={() => setDragging(null)}
              onKeyDown={(e: React.KeyboardEvent<HTMLElement>) => {
                const step =
                  e.key === "ArrowLeft" || e.key === "ArrowUp" ? -1 : e.key === "ArrowRight" || e.key === "ArrowDown" ? 1 : 0;
                if (!step) return;
                e.preventDefault();
                const next = move(p.id, index + step);
                if (next && next !== projects) saveOrder(next);
              }}
            >
              <md-icon>drag_indicator</md-icon>
            </md-icon-button>
            <Link href={`/p/${encodeURIComponent(p.id)}`} className="project-row">
              <md-ripple />
              <md-focus-ring />
              {p.cover ? <img src={mediaUrl(p.cover)} alt="" loading="lazy" /> : <span className="cover empty" />}
              <span className="row-text">
                <span className="name md-typescale-title-medium">{p.name}</span>
                <span className="meta md-typescale-body-medium">
                  {[p.kind, p.year].filter(Boolean).join(" · ") || "No kind or year yet"}
                </span>
              </span>
              <span className="meta md-typescale-body-medium">
                {p.images} image{p.images === 1 ? "" : "s"}
                {p.videos ? `, ${p.videos} video${p.videos === 1 ? "" : "s"}` : ""}
              </span>
              <md-icon className="chevron">chevron_right</md-icon>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}

// Once per page load, even when React runs the first effect twice.
let startedImport = false;
