import * as React from "react";
import { Link } from "wouter";
import { api, mediaUrl, type Summary } from "./api.ts";
import { importSite } from "./import.ts";

// Every project, in the site's order, and the way to a new one. The first time
// the admin opens, storage is empty: it brings the site's projects in first.
export function List() {
  const [projects, setProjects] = React.useState<Summary[] | null>(null);
  const [error, setError] = React.useState("");
  const [importing, setImporting] = React.useState("");

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
        <h1>Projects</h1>
        <Link href="/new" className="primary">
          New project
        </Link>
      </header>
      {importing && <p className="notice">{importing}…</p>}
      {error && (
        <p className="notice">
          {error}{" "}
          <button type="button" className="link" onClick={bringIn}>
            Try again
          </button>
        </p>
      )}
      {!projects && !error && <p className="notice">Loading…</p>}
      <ul className="projects">
        {projects?.map((p) => (
          <li key={p.id}>
            <Link href={`/p/${encodeURIComponent(p.id)}`}>
              {p.cover ? <img src={mediaUrl(p.cover)} alt="" loading="lazy" /> : <span className="cover empty" />}
              <span className="name">{p.name}</span>
              <span className="meta">
                {[p.kind, p.year].filter(Boolean).join(" · ") || "No kind or year yet"}
                <br />
                {p.images} image{p.images === 1 ? "" : "s"}
                {p.videos ? `, ${p.videos} video${p.videos === 1 ? "" : "s"}` : ""}
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}

// Once per page load, even when React runs the first effect twice.
let startedImport = false;
