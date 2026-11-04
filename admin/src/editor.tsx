import * as React from "react";
import { useLocation } from "wouter";
import {
  type Credit,
  type Item,
  isImage,
  isVideo,
  KINDS,
  keys,
  type Options,
  type Project,
  previewStatusId,
  ROLES,
  SITE_URL,
  shownOnSite,
  slug,
} from "../shared.ts";
import { api, type Loaded, mediaUrl } from "./api.ts";
import { Combo } from "./combo.tsx";
import { filesFromDrop } from "./folders.ts";
import { fieldValue } from "./material.ts";
import { upload } from "./upload.ts";

/**
 * One project: its name, kind, year and collaborators, and its images and
 * videos in order of appearance. Files upload as soon as they're added, as
 * they are; saving waits for them, then queues what's new (images for their web
 * copies, videos to be compressed with HandBrake). Each saved video has a
 * button that opens it in the preview cutter: "Create video preview", or
 * "Edit video preview" once it has one (the owner, 5 Nov). The order is
 * dragged by the handle at each row's left (or moved with the arrow keys on a
 * focused handle).
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

type Draft = {
  id: string | null;
  name: string;
  kind: string;
  year: string;
  credits: Credit[];
  items: Row[];
  // "Show on the site".
  published: boolean;
};

// Projects created in this page session: their editor carries on as the
// address changes from /new to the project's own (see main.tsx).
export const createdHere = new Set<string>();

const blank: Draft = {
  id: null,
  name: "",
  kind: "",
  year: "",
  credits: [{ role: "", name: "" }],
  items: [],
  published: false,
};

// A file's name without its extension, for telling whether it's already here.
const stem = (name: string) => name.replace(/\.[^.]+$/, "").toLowerCase();

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
  // Deleting asks once more, on the page.
  const [confirming, setConfirming] = React.useState(false);
  const [dragging, setDragging] = React.useState<string | null>(null);
  const [over, setOver] = React.useState(false);
  const listRef = React.useRef<HTMLOListElement>(null);
  const fileRef = React.useRef<HTMLInputElement>(null);
  const folderRef = React.useRef<HTMLInputElement>(null);
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
          published: shownOnSite(project),
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

  // While anything is being processed, check again every few seconds, so
  // "Waiting" turns into "Ready" without a reload. Only the statuses change;
  // what's being edited stays as it is.
  const processingNow =
    !!loaded && (loaded.processing.length > 0 || Object.values(loaded.status).some((st) => st.state === "processing"));
  const loadedId = loaded?.project.id;
  React.useEffect(() => {
    if (!processingNow || !loadedId) return;
    const timer = window.setInterval(() => {
      api.project(loadedId).then(
        (fresh) => setLoaded((before) => (before ? { ...fresh, project: before.project } : fresh)),
        () => {}
      );
    }, 8000);
    return () => window.clearInterval(timer);
  }, [processingNow, loadedId]);

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
    const media = files.filter((f) => isImage(f.name, f.type) || isVideo(f.name, f.type));
    // A file the project already has (same name, any extension, same kind) is
    // left out, so dropping a whole client folder onto a project brought in
    // from the site adds only what it lacks: its videos (the owner, 4 Nov).
    const kindOf = (name: string, type = "") => (isVideo(name, type) ? "video" : "image");
    const has = new Set(draft.items.map((i) => `${i.type}:${stem(i.file)}`));
    const accepted = media.filter((f) => !has.has(`${kindOf(f.name, f.type)}:${stem(f.name)}`)).sort(byName);
    const notes = [];
    if (accepted.length) notes.push(`Adding ${accepted.length}.`);
    if (media.length > accepted.length) notes.push(`${media.length - accepted.length} already here, skipped.`);
    const other = files.filter((f) => !media.includes(f)).length;
    if (other) notes.push(`${other} not ${other === 1 ? "an image or video" : "images or videos"}, skipped.`);
    setNotice(notes.join(" "));
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
      setNotice("Some uploads failed. Remove them and add them again.");
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
        published: draft.published,
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
      <header className="editor-head">
        <h1 className="md-typescale-headline-medium">{loaded ? draft.name || "Untitled" : "New project"}</h1>
        <div className="publish">
          {/* biome-ignore lint/a11y/noLabelWithoutControl: md-switch is a form control (form-associated custom element) */}
          <label className="md-typescale-body-large">
            <md-switch
              selected={draft.published}
              onInput={(e: React.FormEvent<HTMLElement>) =>
                edit({ published: (e.currentTarget as HTMLElement & { selected: boolean }).selected })
              }
            />
            Show on the site
          </label>
          {loaded && shownOnSite(loaded.project) && (
            <md-outlined-button href={`${SITE_URL}/project/${encodeURIComponent(loaded.project.id)}`} target="_blank">
              View on the site
              <md-icon slot="icon">open_in_new</md-icon>
            </md-outlined-button>
          )}
        </div>
      </header>

      <section className="card">
        <h2 className="md-typescale-title-medium">Details</h2>
        <div className="fields">
          <md-outlined-text-field
            label="Project name"
            value={draft.name}
            onInput={(e: React.FormEvent<HTMLElement>) => edit({ name: fieldValue(e) })}
          />
          <Combo
            label="Kind of work"
            value={draft.kind}
            options={kinds}
            onChange={(kind) => edit({ kind })}
            onRemove={(kind) => api.removeOption("kinds", kind).then(setOptions, () => {})}
          />
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
              <Combo
                label="Role"
                value={credit.role}
                options={roles}
                onChange={(role) => setCredit(i, { role })}
                onRemove={(role) => api.removeOption("roles", role).then(setOptions, () => {})}
              />
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
            filesFromDrop(e.dataTransfer).then(add);
          }}
          onClick={() => fileRef.current?.click()}
        >
          <md-icon>upload</md-icon>
          <span className="md-typescale-body-large">Drop images, videos or folders, or click to choose</span>
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
        <input
          ref={folderRef}
          type="file"
          hidden
          // A whole folder, subfolders included (Chrome, Safari, Firefox).
          {...{ webkitdirectory: "" }}
          onChange={(e) => {
            add([...(e.target.files ?? [])].filter((f) => !f.name.startsWith(".")));
            e.target.value = "";
          }}
        />
        <div className="under-drop">
          <md-text-button disabled={!!saving} onClick={() => folderRef.current?.click()}>
            <md-icon slot="icon">folder_open</md-icon>
            Choose a folder
          </md-text-button>
          {draft.items.length > 1 && (
            <p className="hint md-typescale-body-medium">
              Drag <md-icon>drag_indicator</md-icon> to reorder
            </p>
          )}
        </div>
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
                <span className="name md-typescale-body-large" title={item.file}>
                  {item.file}
                </span>
                <ItemMeta item={item} loaded={loaded} />
              </span>
              <span className="action">
                {item.type === "video" && loaded?.project.items.some((i) => i.id === item.id) && (
                  <md-text-button
                    onClick={() => navigate(`/cutter/${encodeURIComponent(loaded.project.id)}/${encodeURIComponent(item.id)}`)}
                  >
                    <md-icon slot="icon">{hasPreview(item, loaded) ? "edit" : "content_cut"}</md-icon>
                    <span className="label">{hasPreview(item, loaded) ? "Edit video preview" : "Create video preview"}</span>
                  </md-text-button>
                )}
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

      {loaded && (
        <section className="danger">
          {confirming ? (
            <div className="confirm">
              <span className="md-typescale-body-medium">
                Delete {loaded.project.name || "this project"} and all its files? This can't be undone.
              </span>
              <md-text-button onClick={() => setConfirming(false)}>Cancel</md-text-button>
              <md-filled-button
                className="delete"
                onClick={async () => {
                  try {
                    await api.deleteProject(loaded.project.id);
                    setDirty(false);
                    navigate("/");
                  } catch (e) {
                    setConfirming(false);
                    setNotice(e instanceof Error ? e.message : String(e));
                  }
                }}
              >
                Delete
              </md-filled-button>
            </div>
          ) : (
            <md-text-button className="delete-start" onClick={() => setConfirming(true)}>
              <md-icon slot="icon">delete</md-icon>
              Delete project
            </md-text-button>
          )}
        </section>
      )}

      <footer className="save">
        <span className="notice md-typescale-body-medium">
          {notice || (saving ? "" : dirty ? "Unsaved changes." : loaded ? "All changes saved." : "")}
        </span>
        <md-filled-button onClick={save} disabled={!!saving || (!!loaded && !dirty && !uploading)}>
          {saving || (loaded ? "Save" : "Save project")}
        </md-filled-button>
      </footer>
    </div>
  );
}

// An image's small copy; a video's first frame once it's processed (the still
// the site shows), until then the video itself.
function Thumb({ item, loaded }: { item: Row; loaded: Loaded | null }) {
  const canvas = item.copies?.canvas ?? loaded?.status[item.id]?.copies?.canvas;
  let picture: React.ReactNode = <span className="thumb empty" />;
  if (canvas) picture = <img className="thumb" src={mediaUrl(canvas)} alt="" loading="lazy" />;
  else if (item.type === "image" && item.local) picture = <img className="thumb" src={item.local.url} alt="" />;
  else if (item.type === "video") {
    const compressed = loaded?.status[item.id]?.video;
    const src = item.local?.url ?? (compressed ? mediaUrl(compressed) : item.original ? mediaUrl(item.original) : null);
    if (src) picture = <video className="thumb" src={`${src}#t=0.5`} preload="metadata" muted />;
  }
  if (item.type !== "video") return picture;
  return (
    <span className="thumb-wrap">
      {picture}
      <md-icon className="badge">play_arrow</md-icon>
    </span>
  );
}

// A video has a preview once one is made, being made or waiting to be.
function hasPreview(item: Row, loaded: Loaded | null) {
  const id = previewStatusId(item.id);
  return !!loaded?.status[id] || !!loaded?.processing.includes(id);
}

type Tone = "plain" | "busy" | "wait" | "error";
const ICONS: Record<Tone, string | null> = { plain: null, busy: "progress_activity", wait: "schedule", error: "error" };

// Where an item stands, in a word or two, or nothing for an image that's
// ready: the row only speaks up when something is still to happen or went
// wrong. A ready video says what its preview is.
function describe(item: Row, loaded: Loaded | null): { tone: Tone; text: string; why?: string } | null {
  const local = item.local;
  if (local?.state === "uploading") return { tone: "busy", text: `Uploading ${Math.floor(local.progress * 100)}%` };
  if (local?.state === "failed") return { tone: "error", text: "Upload failed", why: local.error };
  const saved = loaded?.project.items.some((i) => i.id === item.id);
  if (!saved) return { tone: "wait", text: "Not saved yet" };
  const status = loaded?.status[item.id];
  if (item.copies || status?.state === "done") {
    if (item.type !== "video") return null;
    const preview = loaded?.status[previewStatusId(item.id)];
    if (loaded?.processing.includes(previewStatusId(item.id)) || preview?.state === "processing")
      return { tone: "busy", text: "Making preview" };
    if (preview?.state === "failed") return { tone: "error", text: "Preview failed", why: preview.message };
    if (preview?.state === "done") return { tone: "plain", text: preview.auto ? "Automatic preview" : "Custom preview" };
    return { tone: "plain", text: "No preview" };
  }
  if (status?.state === "failed") return { tone: "error", text: "Couldn't process", why: status.message };
  if (status?.state === "processing") return { tone: "busy", text: item.type === "video" ? "Compressing" : "Processing" };
  if (loaded?.processing.includes(item.id)) return { tone: "wait", text: "Waiting" };
  return { tone: "wait", text: "Not processed" };
}

// The line under the file name: kind, size and where it stands.
function ItemMeta({ item, loaded }: { item: Row; loaded: Loaded | null }) {
  const state = describe(item, loaded);
  const icon = state && ICONS[state.tone];
  return (
    <>
      <span className="meta md-typescale-body-medium">
        <span>
          {item.type === "video" ? "Video" : "Image"}
          {item.size ? ` · ${size(item.size)}` : ""}
        </span>
        {state && (
          <span className={`state ${state.tone}`} title={state.why}>
            {icon && <md-icon>{icon}</md-icon>}
            <span className="state-text">{state.text}</span>
          </span>
        )}
      </span>
      {item.local?.state === "uploading" && <md-linear-progress value={item.local.progress} />}
    </>
  );
}
