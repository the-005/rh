import * as React from "react";
import { Link, useLocation } from "wouter";
import { api, type CutterRow, mediaUrl } from "./api.ts";
import { mountCutter } from "./cutter-core.ts";

const stateOf = (row: CutterRow) =>
  row.preview === "done"
    ? "Ready"
    : row.preview === "processing"
      ? "Making preview"
      : row.preview === "failed"
        ? "Preview failed"
        : row.todo
          ? "To do"
          : "Waiting";

// The Preview Cutter's queue: every video in every project, to do first.
export function CutterList() {
  const [rows, setRows] = React.useState<CutterRow[] | null>(null);
  const [error, setError] = React.useState("");
  React.useEffect(() => {
    api.cutter().then(setRows, (e: Error) => setError(e.message));
  }, []);

  const todo = rows?.filter((r) => r.todo).length ?? 0;
  const projects = [...new Set(rows?.map((r) => r.project))];
  return (
    <div className="cutter-list">
      <header className="list-head">
        <h1 className="md-typescale-headline-medium">Video previews</h1>
        {rows && (
          <span className="notice md-typescale-body-medium">
            {todo} to do, {rows.length - todo} done
          </span>
        )}
      </header>
      {error && <p className="notice">{error}</p>}
      {!rows && !error && <p className="notice">Loading…</p>}
      {rows?.length === 0 && <p className="notice">No videos yet. Add some to a project.</p>}
      {projects.map((id) => {
        const group = (rows ?? []).filter((r) => r.project === id);
        return (
          <section key={id} className="card">
            <h2 className="md-typescale-title-medium">{group[0].projectName}</h2>
            <ul className="cutter-rows">
              {group.map((row) => (
                <li key={row.item}>
                  <Link href={`/cutter/${encodeURIComponent(row.project)}/${encodeURIComponent(row.item)}`}>
                    <md-ripple />
                    <md-icon>{row.preview === "done" ? "check_circle" : "content_cut"}</md-icon>
                    <span className="md-typescale-body-large">{row.file}</span>
                    <span className={`md-typescale-body-medium state${row.todo ? " todo" : ""}`}>
                      {stateOf(row)}
                      {!row.compressed && " · not compressed"}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        );
      })}
    </div>
  );
}

// One video in the preview cutter, opened from its project's "Create video
// preview" button (the owner, 4 Nov: a button on each video rather than a
// "Preview Cutter" section). The queue above is still at /cutter, unlinked.
export function CutterView({ project, item }: { project: string; item: string }) {
  const [, navigate] = useLocation();
  const [row, setRow] = React.useState<CutterRow | null>(null);
  const [next, setNext] = React.useState<CutterRow | null>(null);
  const [plan, setPlan] = React.useState<{ cuts?: number[]; pieces?: { s: number; e: number }[] } | null>(null);
  // Shown only while something's happening: opening, saving, an error.
  const [status, setStatus] = React.useState("Opening…");
  const [error, setError] = React.useState("");
  const [saved, setSaved] = React.useState(false);
  const refs = {
    root: React.useRef<HTMLDivElement>(null),
    stage: React.useRef<HTMLDivElement>(null),
    videoA: React.useRef<HTMLVideoElement>(null),
    videoB: React.useRef<HTMLVideoElement>(null),
    playButton: React.useRef<HTMLButtonElement>(null),
    playIcon: React.useRef<SVGPathElement>(null),
    track: React.useRef<HTMLDivElement>(null),
    strip: React.useRef<HTMLCanvasElement>(null),
    ticks: React.useRef<HTMLDivElement>(null),
    pieces: React.useRef<HTMLDivElement>(null),
    playhead: React.useRef<HTMLDivElement>(null),
    tip: React.useRef<HTMLDivElement>(null),
    readout: React.useRef<HTMLDivElement>(null),
    hint: React.useRef<HTMLDivElement>(null),
    addButton: React.useRef<HTMLButtonElement>(null),
    saveButton: React.useRef<HTMLButtonElement>(null),
  };

  React.useEffect(() => {
    let live = true;
    Promise.all([api.cutter(), api.plan(project, item)]).then(
      ([rows, found]) => {
        if (!live) return;
        const here = rows.find((r) => r.project === project && r.item === item) ?? null;
        if (!here) setError("No such video.");
        // Nothing to open until it's compressed (the stage says so).
        if (here && !here.compressed) setStatus("");
        setRow(here);
        // After saving, the next video in the same project still without a preview.
        setNext(rows.find((r) => r.project === project && r.todo && r.item !== item) ?? null);
        setPlan(found);
      },
      (e: Error) => live && setError(e.message)
    );
    return () => {
      live = false;
    };
  }, [project, item]);

  // The compressed version, which the preview is cut from.
  const source = row?.compressed ?? null;

  React.useEffect(() => {
    if (!source || !plan) return;
    const elements = Object.fromEntries(Object.entries(refs).map(([k, r]) => [k, r.current]));
    if (Object.values(elements).some((v) => !v)) return;
    return mountCutter({
      elements: elements as unknown as Parameters<typeof mountCutter>[0]["elements"],
      url: mediaUrl(source),
      cuts: plan.cuts,
      pieces: plan.pieces,
      status: setStatus,
      foundCuts: (cuts) => {
        api.savePlan(project, item, { cuts }).catch(() => {});
      },
      save: async (pieces) => {
        setStatus("Saving…");
        try {
          await api.savePlan(project, item, { pieces });
          setSaved(true);
          setStatus("Saved. Ready in a few minutes.");
        } catch (e) {
          setStatus(`Couldn't save: ${e instanceof Error ? e.message : String(e)}`);
        }
      },
    });
    // refs are stable; the cutter mounts once per video
    // biome-ignore lint/correctness/useExhaustiveDependencies: refs are stable
  }, [source, plan, project, item]);

  return (
    <div className="cutter" ref={refs.root}>
      <header className="cutter-top">
        <md-text-button onClick={() => navigate(`/p/${encodeURIComponent(project)}`)}>
          <md-icon slot="icon">arrow_back</md-icon>
          {row?.projectName ?? "Back"}
        </md-text-button>
        <div className="cutter-title md-typescale-body-large">{row ? row.file : error || "Loading…"}</div>
        <div className="cutter-status md-typescale-body-medium">
          {saved && next ? (
            <md-filled-button
              onClick={() => navigate(`/cutter/${encodeURIComponent(next.project)}/${encodeURIComponent(next.item)}`)}
            >
              Next video in this project
              <md-icon slot="icon">arrow_forward</md-icon>
            </md-filled-button>
          ) : (
            status
          )}
        </div>
      </header>

      <div className="cutter-stage" ref={refs.stage}>
        <video ref={refs.videoA} className="on" muted playsInline preload="auto" />
        <video ref={refs.videoB} muted playsInline preload="auto" />
        {row && !source && <p className="cutter-empty">This video is still being compressed.</p>}
      </div>

      <footer className="cutter-bar">
        <button type="button" className="play" ref={refs.playButton} aria-label="Play preview" disabled>
          <svg viewBox="0 0 18 18" aria-hidden="true">
            <path ref={refs.playIcon} d="M4 2.5v13l11-6.5z" />
          </svg>
        </button>
        <div className="track-wrap">
          <div className="track" ref={refs.track}>
            <canvas ref={refs.strip} />
            <div className="ticks" ref={refs.ticks} />
            <div ref={refs.pieces} />
            <div className="playhead" ref={refs.playhead} />
          </div>
          <div className="tip" ref={refs.tip} />
        </div>
        <div className="side">
          <div className="readout md-typescale-body-medium" ref={refs.readout} />
          <div className="buttons">
            <button type="button" className="tonal" ref={refs.addButton} disabled>
              Add piece
            </button>
            <button type="button" className="filled" ref={refs.saveButton} disabled>
              Save preview
            </button>
          </div>
          <div className="hint md-typescale-body-small" ref={refs.hint} />
        </div>
      </footer>
    </div>
  );
}
