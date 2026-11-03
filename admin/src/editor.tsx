import * as React from "react";
import { useLocation } from "wouter";
import { type Credit, type Item, isImage, isVideo, KINDS, keys, type Options, type Project, ROLES, slug } from "../shared.ts";
import { api, type Loaded, mediaUrl } from "./api.ts";
import { Combo } from "./combo.tsx";
import { fieldValue } from "./material.ts";
import { upload } from "./upload.ts";

/**
 * One project: its name, kind, year and collaborators, and its images and
 * videos in order of appearance. Files upload as soon as they're added, as
 * they are; saving waits for them, then queues what's new (images for their web
 * copies, videos to be compressed with HandBrake and for the Preview Cutter). The order is dragged by the handle at
 * each row's left (or moved with the arrow keys on a focused handle).
 */

// A file added in this session: its upload, and a preview from the file itself.
type Local = {
  url: string;
  progress: number;
  state: "uploading" | "uploaded" | "failed";
  error?: string;
  // Resolves to whether the upload worked; never rejects.
  finished: Promise<boolean>;
};

type Row = Item & { local?: Local };

type Draft = { id: string | null; name: string; kind: string; year: string; credits: Credit[]; items: Row[] };

// Projects created in this page session: their editor carries on as the
// address changes from /new to the project's own (see main.tsx).
export const createdHere = new Set<string>();

const blank: Draft = { id: null, name: "", kind: "", year: "", credits: [{ role: "", name: "" }], items: [] };

const byName = (a: File, b: File) => a.name.localeCompare(b.name, undefined, { numeric: true });

const size = (bytes = 0) =>
  bytes > 1e9
    ? `${(bytes / 1e9).toFixed(1)} GB`
    : bytes > 1e6
      ? `${(bytes / 1e6).toFixed(1)} MB`
      : `${Math.ceil(bytes / 1e3)} KB`;

export function Editor({ id }: { id: string | null }) {
  const [, navigate] = useLocation();
  const [draft, setDraft] = React.useState<Draft>(blank);
  const [options, setOptions] = React.useState<Options>({ kinds: KINDS, roles: ROLES });
  const [loaded, setLoaded] = React.useState<Loaded | null>(null);
  const [notice, setNotice] = React.useState("");
  const [saving, setSaving] = React.useState("");
  const [dirty, setDirty] = React.useState(false);
  const [dragging, setDragging] = React.useState<string | null>(null);
  const [over, setOver] = React.useState(false);
  const listRef = React.useRef<HTMLOListElement>(null);
  const fileRef = React.useRef<HTMLInputElement>(null);
  // The project this editor already holds, so arriving at its address after
  // the first save doesn't load it again over this session's previews.
  const holding = React.useRef<string | null>(null);

  React.useEffect(() => {
    if (!id || holding.current === id) return;
    let live = true;
    api.project(id).then(
      (found) => {
        if (!live) return;
        setLoaded(found);
        const { project } = found;
        setDraft({
          id: project.id,
          name: project.name,
          kind: project.kind,
          year: project.year,
          credits: project.credits.length ? project.credits : [{ role: "", name: "" }],
          items: project.items,
        });
      },
      (error) => live && setNotice(error.message)
    );
    return () => {
      live = false;
    };
  }, [id]);

  React.useEffect(() => {
    api.options().then(setOptions, () => {});
  }, []);

  const uploading = draft.items.some((i) => i.local?.state === "uploading");

  // Leaving with uploads running or changes unsaved asks first.
  React.useEffect(() => {
    if (!uploading && !dirty) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [uploading, dirty]);

  const edit = (patch: Partial<Draft>) => {
    setDraft((d) => ({ ...d, ...patch }));
    setDirty(true);
  };

  const editRow = (itemId: string, patch: Partial<Local>) =>
    setDraft((d) => ({
      ...d,
      items: d.items.map((i) => (i.id === itemId && i.local ? { ...i, local: { ...i.local, ...patch } } : i)),
    }));

  // A new project's id comes from its name the first time it needs one (the
  // first file added, or the first save), and never changes after: it's the
  // project's address on the site.
  async function ensureId() {
    if (draft.id) return draft.id;
    if (!draft.name.trim()) {
      setNotice("Give the project a name first.");
      return null;
    }
    const taken = new Set((await api.projects()).map((p) => p.id));
    const base = slug(draft.name);
    let next = base;
    for (let n = 2; taken.has(next); n++) next = `${base}-${n}`;
    setDraft((d) => ({ ...d, id: next }));
    return next;
  }

  async function add(files: File[]) {
    setNotice("");
    const projectId = await ensureId();
    if (!projectId) return;
    const accepted = files.filter((f) => isImage(f.name, f.type) || isVideo(f.name, f.type)).sort(byName);
    const skipped = files.filter((f) => !accepted.includes(f));
    if (skipped.length) setNotice(`Skipped what isn't an image or a video: ${skipped.map((f) => f.name).join(", ")}`);
    const rows: Row[] = accepted.map((file) => {
      const itemId = crypto.randomUUID().slice(0, 8);
      const original = keys.original(projectId, itemId, file.name);
      const finished = upload(original, file, (progress) => editRow(itemId, { progress })).then(
        () => {
          editRow(itemId, { state: "uploaded", progress: 1 });
          return true;
        },
        (error: Error) => {
          editRow(itemId, { state: "failed", error: error.message });
          return false;
        }
      );
      return {
        id: itemId,
        type: isVideo(file.name, file.type) ? "video" : "image",
        file: file.name,
        original,
        size: file.size,
        local: { url: URL.createObjectURL(file), progress: 0, state: "uploading", finished },
      };
    });
    if (!rows.length) return;
    setDraft((d) => ({ ...d, items: [...d.items, ...rows] }));
    setDirty(true);
  }

  async function save() {
    setNotice("");
    const projectId = await ensureId();
    if (!projectId) return;
    const pending = draft.items.filter((i) => i.local?.state === "uploading");
    if (pending.length) setSaving(`Waiting for ${pending.length} upload${pending.length === 1 ? "" : "s"}…`);
    const results = await Promise.all(draft.items.map((i) => i.local?.finished ?? true));
    if (results.includes(false)) {
      setSaving("");
      setNotice("Some files didn't upload. Remove them (×) and add them again, then save.");
      return;
    }
    setSaving("Saving…");
    try {
      const project: Project = {
        id: projectId,
        name: draft.name,
        kind: draft.kind,
        year: draft.year,
        credits: draft.credits,
        items: draft.items.map(({ local: _, ...item }) => item),
        created: "",
        updated: "",
      };
      const saved = await api.save(project, !loaded);
      setLoaded(saved);
      // Keep this session's previews until the web copies exist, as they are
      // now (the uploads finished while this waited).
      setDraft((d) => {
        const locals = new Map(d.items.map((i) => [i.id, i.local]));
        return { ...d, items: saved.project.items.map((i) => ({ ...i, local: locals.get(i.id) })) };
      });
      setDirty(false);
      setNotice("Saved.");
      holding.current = projectId;
      if (!id) {
        createdHere.add(projectId);
        navigate(`/p/${encodeURIComponent(projectId)}`, { replace: true });
      }
    } catch (error) {
      setNotice(error instanceof Error ? error.message : String(error));
    } finally {
      setSaving("");
    }
  }

  // Moves an item to a new place in the order.
  const move = (itemId: string, to: number) => {
    const from = draft.items.findIndex((i) => i.id === itemId);
    if (from < 0 || to === from || to < 0 || to >= draft.items.length) return;
    const items = [...draft.items];
    const [item] = items.splice(from, 1);
    items.splice(to, 0, item);
    edit({ items });
  };

  // Dragging: the item goes before the first row whose middle is below the
  // pointer.
  // While dragging near the top or bottom of the window (under the app bar or
  // above the save bar), the page scrolls, so an image can travel the length
  // of a long project.
  const pointerY = React.useRef(0);
  React.useEffect(() => {
    if (!dragging) return;
    let frame = 0;
    const tick = () => {
      const y = pointerY.current;
      const step = y > window.innerHeight - 120 ? 14 : y < 120 ? -14 : 0;
      if (step) window.scrollBy(0, step);
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [dragging]);

  const onDragMove = (e: React.PointerEvent) => {
    pointerY.current = e.clientY;
    if (!dragging || !listRef.current) return;
    const rows = [...listRef.current.children];
    let before = rows.findIndex((row) => {
      const box = row.getBoundingClientRect();
      return e.clientY < box.top + box.height / 2;
    });
    if (before < 0) before = rows.length;
    const from = draft.items.findIndex((i) => i.id === dragging);
    move(dragging, before > from ? before - 1 : before);
  };

  const credits = draft.credits;
  const setCredit = (i: number, patch: Partial<Credit>) =>
    edit({ credits: credits.map((c, j) => (j === i ? { ...c, ...patch } : c)) });
  // The shared lists, plus whatever this project already uses that they lack.
  const withValues = (list: string[], values: string[]) => [
    ...list,
    ...values.filter((v, i) => v && values.indexOf(v) === i && !list.some((o) => o.toLowerCase() === v.toLowerCase())),
  ];
  const kinds = withValues(options.kinds, [draft.kind]);
  const roles = withValues(
    options.roles,
    credits.map((c) => c.role)
  );

  if (id && !loaded) return <p className="notice md-typescale-body-large">{notice || "Loading…"}</p>;

  return (
    <div className="editor">
      <md-text-button onClick={() => navigate("/")}>
        <md-icon slot="icon">arrow_back</md-icon>
        All projects
      </md-text-button>
      <h1 className="md-typescale-headline-medium">{loaded ? draft.name || "Untitled" : "New project"}</h1>

      <section className="card">
        <h2 className="md-typescale-title-medium">Details</h2>
        <div className="fields">
          <md-outlined-text-field
            label="Project name"
            value={draft.name}
            onInput={(e: React.FormEvent<HTMLElement>) => edit({ name: fieldValue(e) })}
          />
          <Combo label="Kind of work" value={draft.kind} options={kinds} onChange={(kind) => edit({ kind })} />
          <md-outlined-text-field
            label="Year"
            value={draft.year}
            inputMode="numeric"
            onInput={(e: React.FormEvent<HTMLElement>) => edit({ year: fieldValue(e).replace(/\D/g, "").slice(0, 4) })}
          />
        </div>
      </section>

      <section className="card">
        <h2 className="md-typescale-title-medium">Collaborators</h2>
        <ul className="credits">
          {credits.map((credit, i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: rows have no identity beyond their place
            <li key={i}>
              <Combo label="Role" value={credit.role} options={roles} onChange={(role) => setCredit(i, { role })} />
              <md-outlined-text-field
                label="Name"
                value={credit.name}
                onInput={(e: React.FormEvent<HTMLElement>) => setCredit(i, { name: fieldValue(e) })}
              />
              <md-icon-button
                aria-label="Remove collaborator"
                onClick={() => edit({ credits: credits.filter((_, j) => j !== i) })}
              >
                <md-icon>close</md-icon>
              </md-icon-button>
            </li>
          ))}
        </ul>
        <md-text-button onClick={() => edit({ credits: [...credits, { role: "", name: "" }] })}>
          <md-icon slot="icon">add</md-icon>
          Add collaborator
        </md-text-button>
      </section>

      <section className="card">
        <h2 className="md-typescale-title-medium">Images and videos</h2>
        <button
          type="button"
          className={over ? "drop over" : "drop"}
          disabled={!!saving}
          onDragOver={(e) => {
            e.preventDefault();
            setOver(true);
          }}
          onDragLeave={() => setOver(false)}
          onDrop={(e) => {
            e.preventDefault();
            setOver(false);
            add([...e.dataTransfer.files]);
          }}
          onClick={() => fileRef.current?.click()}
        >
          <md-icon>upload</md-icon>
          <span className="md-typescale-body-large">Drop images and videos here, or click to choose</span>
          <span className="md-typescale-body-medium">They upload as they are, any size.</span>
        </button>
        <input
          ref={fileRef}
          type="file"
          multiple
          accept="image/*,video/*"
          hidden
          onChange={(e) => {
            add([...(e.target.files ?? [])]);
            e.target.value = "";
          }}
        />

        {draft.items.length > 0 && (
          <p className="hint md-typescale-body-medium">
            Drag <md-icon>drag_indicator</md-icon> to change the order. The first one opens the project.
          </p>
        )}
        <ol ref={listRef} className="items" onPointerMove={onDragMove}>
          {draft.items.map((item, index) => (
            <li key={item.id} className={dragging === item.id ? "dragging" : undefined}>
              <md-icon-button
                className="handle"
                disabled={!!saving}
                aria-label={`Move ${item.file} (arrow keys)`}
                onPointerDown={(e: React.PointerEvent<HTMLElement>) => {
                  e.preventDefault();
                  e.currentTarget.setPointerCapture(e.pointerId);
                  setDragging(item.id);
                }}
                onPointerUp={() => setDragging(null)}
                onPointerCancel={() => setDragging(null)}
                onKeyDown={(e: React.KeyboardEvent<HTMLElement>) => {
                  if (e.key === "ArrowUp") move(item.id, index - 1);
                  if (e.key === "ArrowDown") move(item.id, index + 1);
                }}
              >
                <md-icon>drag_indicator</md-icon>
              </md-icon-button>
              <span className="number md-typescale-label-large">{index + 1}</span>
              <Thumb item={item} loaded={loaded} />
              <span className="file">
                <span className="md-typescale-body-large">{item.file}</span>
                <span className="md-typescale-body-small">
                  {item.type === "video" ? "Video" : "Image"}
                  {item.size ? ` · ${size(item.size)}` : ""}
                </span>
              </span>
              <span className="state md-typescale-body-medium">
                {describe(item, loaded)}
                {item.local?.state === "uploading" && <md-linear-progress value={item.local.progress} />}
              </span>
              <md-icon-button
                disabled={!!saving}
                aria-label={`Remove ${item.file}`}
                onClick={() => edit({ items: draft.items.filter((i) => i.id !== item.id) })}
              >
                <md-icon>delete</md-icon>
              </md-icon-button>
            </li>
          ))}
        </ol>
      </section>

      <footer className="save">
        <span className="notice md-typescale-body-medium">{notice || (dirty && !saving ? "Unsaved changes." : "")}</span>
        <md-filled-button onClick={save} disabled={!!saving}>
          {saving || (loaded ? "Save" : "Save project")}
        </md-filled-button>
      </footer>
    </div>
  );
}

function Thumb({ item, loaded }: { item: Row; loaded: Loaded | null }) {
  const canvas = item.copies?.canvas ?? loaded?.status[item.id]?.copies?.canvas;
  if (item.type === "image") {
    const src = canvas ? mediaUrl(canvas) : item.local?.url;
    return src ? <img className="thumb" src={src} alt="" loading="lazy" /> : <span className="thumb empty" />;
  }
  const compressed = loaded?.status[item.id]?.video;
  const src = item.local?.url ?? (compressed ? mediaUrl(compressed) : item.original ? mediaUrl(item.original) : null);
  return src ? <video className="thumb" src={`${src}#t=0.5`} preload="metadata" muted /> : <span className="thumb empty" />;
}

function describe(item: Row, loaded: Loaded | null) {
  const local = item.local;
  if (local?.state === "uploading") return `Uploading ${Math.floor(local.progress * 100)}%`;
  if (local?.state === "failed") return `Upload failed: ${local.error}`;
  const saved = loaded?.project.items.some((i) => i.id === item.id);
  if (!saved) return "Uploaded. Processed once saved.";
  const status = loaded?.status[item.id];
  if (item.type === "video") {
    const cutter = loaded?.cutter.includes(item.id) ? " In the Preview Cutter queue." : "";
    if (status?.state === "done") return `Compressed (${status.width}×${status.height}).${cutter}`;
    if (status?.state === "failed") return `Couldn't compress: ${status.message ?? "unknown error"}`;
    if (status?.state === "processing") return `Compressing with HandBrake…${cutter}`;
    if (loaded?.processing.includes(item.id)) return `Waiting to be compressed (starts within about 15 minutes).${cutter}`;
    return `Kept as uploaded.${cutter}`;
  }
  if (item.copies || status?.state === "done") return "Ready";
  if (status?.state === "failed") return `Couldn't make the web copies: ${status.message ?? "unknown error"}`;
  if (status?.state === "processing") return "Processing…";
  if (loaded?.processing.includes(item.id)) return "Waiting to be processed (usually within 15 minutes).";
  return "";
}
