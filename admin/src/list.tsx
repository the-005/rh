import * as React from "react";
import { Link, useLocation } from "wouter";
import { api, mediaUrl, type Summary } from "./api.ts";
import { importSite } from "./import.ts";
import { SplashSetting } from "./splash.tsx";
import { Group, Icon, Page } from "./ui.tsx";

// Every project, in the site's order, and the way to a new one. The first time
// the admin opens, storage is empty: it brings the site's projects in first.
//
// The order is the order the site lists the projects in (the owner, 4 Nov;
// site.json, see admin/site-data.ts). As in iOS, Edit shows a reorder control
// at the end of each row: drag it, or use the arrow keys on it. The order is
// saved as soon as a row is let go.
export function List({ email }: { email: string }) {
  const [, navigate] = useLocation();
  const [projects, setProjects] = React.useState<Summary[] | null>(null);
  const [error, setError] = React.useState("");
  const [importing, setImporting] = React.useState("");
  const [editing, setEditing] = React.useState(false);
  const [dragging, setDragging] = React.useState<string | null>(null);
  const [orderNote, setOrderNote] = React.useState("");
  const listRef = React.useRef<HTMLUListElement>(null);
  const pointerY = React.useRef(0);
  // The order when a drag began, to save only when it changed.
  const startOrder = React.useRef("");

  async function saveOrder(list: Summary[]) {
    setOrderNote("Saving…");
    try {
      await api.order(list.map((p) => p.id));
      setOrderNote("Order saved.");
    } catch (e) {
      setOrderNote(`The order wasn't saved: ${e instanceof Error ? e.message : String(e)}`);
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

  // Dragging: the row goes before the first row whose middle is below the pointer.
  const onDragMove = (e: React.PointerEvent) => {
    pointerY.current = e.clientY;
    if (!dragging || !listRef.current || !projects) return;
    const rows = [...listRef.current.children];
    let before = rows.findIndex((row) => {
      const box = row.getBoundingClientRect();
      return e.clientY < box.top + box.height / 2;
    });
    if (before < 0) before = rows.length;
    const from = projects.findIndex((p) => p.id === dragging);
    move(dragging, before > from ? before - 1 : before);
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

  const canReorder = !!projects && projects.length > 1;

  return (
    <Page
      title="Projects"
      leading={
        canReorder && (
          <button
            type="button"
            className={editing ? "glass prominent" : "glass"}
            onClick={() => {
              setEditing(!editing);
              setOrderNote("");
            }}
          >
            {editing ? "Done" : "Edit"}
          </button>
        )
      }
      trailing={
        <button type="button" className="glass round" aria-label="New Project" title="New Project" onClick={() => navigate("/new")}>
          <Icon name="add" />
        </button>
      }
    >
      {importing && (
        <output className="notice">
          {importing}…
          <progress className="progress" />
        </output>
      )}
      {error && (
        <p className="notice error" role="alert">
          {error}{" "}
          <button type="button" className="plain" onClick={bringIn}>
            Try Again
          </button>
        </p>
      )}
      {!projects && !error && <p className="notice">Loading…</p>}
      {projects && projects.length > 0 && (
        <Group
          footer={
            editing ? (
              <output>{orderNote || "Drag to set the order the site shows them in."}</output>
            ) : undefined
          }
        >
          <ul ref={listRef} onPointerMove={onDragMove}>
            {projects.map((p, index) => {
              const content = (
                <>
                  {p.cover ? <img className="cover" src={mediaUrl(p.cover)} alt="" loading="lazy" /> : <span className="cover" />}
                  <span className="row-text">
                    <span className="row-title">{p.name}</span>
                    <span className="row-subtitle">
                      {[
                        p.kind,
                        p.year,
                        p.images && `${p.images} image${p.images === 1 ? "" : "s"}`,
                        p.videos && `${p.videos} video${p.videos === 1 ? "" : "s"}`,
                      ]
                        .filter(Boolean)
                        .join(" · ")}
                    </span>
                  </span>
                  {!p.shown && (
                    <span className="detail" title="Not on the site">
                      <Icon name="visibility_off" /> <span className="label">Hidden</span>
                    </span>
                  )}
                </>
              );
              return (
                <li key={p.id} className={dragging === p.id ? "dragging" : undefined}>
                  {editing ? (
                    <div className="row project-row">
                      {content}
                      <button
                        type="button"
                        className="icon-button handle"
                        aria-label={`Reorder ${p.name}. Use the up and down arrow keys.`}
                        onPointerDown={(e) => {
                          e.preventDefault();
                          e.currentTarget.setPointerCapture(e.pointerId);
                          pointerY.current = e.clientY;
                          startOrder.current = projects.map((x) => x.id).join("/");
                          setDragging(p.id);
                        }}
                        onPointerUp={() => {
                          setDragging(null);
                          if (projects.map((x) => x.id).join("/") !== startOrder.current) saveOrder(projects);
                        }}
                        onPointerCancel={() => setDragging(null)}
                        onKeyDown={(e) => {
                          const step = e.key === "ArrowUp" ? -1 : e.key === "ArrowDown" ? 1 : 0;
                          if (!step) return;
                          e.preventDefault();
                          const next = move(p.id, index + step);
                          if (next && next !== projects) saveOrder(next);
                        }}
                      >
                        <Icon name="menu" />
                      </button>
                    </div>
                  ) : (
                    <Link href={`/p/${encodeURIComponent(p.id)}`} className="row link project-row">
                      {content}
                      <Icon name="chevron_right" className="chevron" />
                    </Link>
                  )}
                </li>
              );
            })}
          </ul>
        </Group>
      )}
      {projects && <SplashSetting />}
      {email && <p className="footnote">Signed in as {email}</p>}
    </Page>
  );
}

// Once per page load, even when React runs the first effect twice.
let startedImport = false;
