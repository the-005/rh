import * as React from "react";
import { Link, useLocation } from "wouter";
import { api, mediaUrl, type Summary } from "./api.ts";
import { importSite } from "./import.ts";
import "./material.ts";

// Every project, in the site's order, and the way to a new one. The first time
// the admin opens, storage is empty: it brings the site's projects in first.
export function List() {
  const [, navigate] = useLocation();
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
      <ul className="projects">
        {projects?.map((p) => (
          <li key={p.id}>
            <Link href={`/p/${encodeURIComponent(p.id)}`} className="project-card">
              <md-ripple />
              <md-focus-ring />
              {p.cover ? <img src={mediaUrl(p.cover)} alt="" loading="lazy" /> : <span className="cover empty" />}
              <span className="name md-typescale-title-medium">{p.name}</span>
              <span className="meta md-typescale-body-medium">
                {[p.kind, p.year].filter(Boolean).join(" · ") || "No kind or year yet"}
              </span>
              <span className="meta md-typescale-body-small">
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
