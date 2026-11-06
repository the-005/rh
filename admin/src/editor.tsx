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
import { Alert, Group, Icon, Page, State, Switch, type Tone } from "./ui.tsx";
import { upload } from "./upload.ts";

/**
 * One project: its name, kind, year and collaborators, and its images and
 * videos in order of appearance. Files upload as soon as they're added, as
 * they are; saving waits for them, then queues what's new (images for their web
 * copies, videos to be compressed with HandBrake). Each saved video has a
 * button that opens it in the preview cutter: Create Preview, or Edit
 * Preview once it has one (the owner, 5 Nov). The order is dragged by the
 * reorder control at each row's end (or moved with the arrow keys on it).
 * Laid out as a Settings page (ui.tsx): Save in the navigation bar, how the
 * save stands in the toolbar, an alert before deleting.
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
  const [noticeIsError, setNoticeIsError] = React.useState(false);
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
      (error) => live && say(error.message, true)
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

  // A line in the toolbar: what just happened, or what went wrong and what to do.
  const say = (text: string, error = false) => {
    setNotice(text);
    setNoticeIsError(error);
  };

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
      say("Give the project a name first.", true);
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
    say("");
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
    say(notes.join(" "));
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
    say("");
    const projectId = await ensureId();
    if (!projectId) return;
    const pending = draft.items.filter((i) => i.local?.state === "uploading");
    if (pending.length) setSaving(`Waiting for ${pending.length} upload${pending.length === 1 ? "" : "s"}…`);
    const results = await Promise.all(draft.items.map((i) => i.local?.finished ?? true));
    if (results.includes(false)) {
      setSaving("");
      say("Some uploads failed. Remove them and add them again.", true);
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
      say("Saved.");
      holding.current = projectId;
      if (!id) {
        createdHere.add(projectId);
        navigate(`/p/${encodeURIComponent(projectId)}`, { replace: true });
      }
    } catch (error) {
      say(error instanceof Error ? error.message : String(error), true);
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

  const back = { label: "Projects", onClick: () => navigate("/") };

  if (id && !loaded)
    return (
      <Page title="Project" back={back}>
        <p className={notice ? "notice error" : "notice"}>{notice || "Loading…"}</p>
      </Page>
    );

  // The toolbar speaks only when there's something to say: a disabled Save
  // already says everything is saved.
  const status = notice || saving || (dirty ? "Unsaved changes" : "");
  const name = loaded ? draft.name || "Untitled" : "New Project";

  return (
    <Page
      title={name}
      back={back}
      trailing={
        <button
          type="button"
          className="glass prominent"
          onClick={save}
          disabled={!!saving || (!!loaded && !dirty && !uploading)}
        >
          Save
        </button>
      }
      toolbar={status && <output className={noticeIsError ? "error" : undefined}>{status}</output>}
    >
      <Group>
        <label className="row field">
          <span className="field-label">Name</span>
          <input className="input" placeholder="Required" value={draft.name} onChange={(e) => edit({ name: e.target.value })} />
        </label>
        <div className="row field">
          <span className="field-label">Kind of Work</span>
          <Combo
            label="Kind of Work"
            placeholder="None"
            value={draft.kind}
            options={kinds}
            onChange={(kind) => edit({ kind })}
            onRemove={(kind) => api.removeOption("kinds", kind).then(setOptions, () => {})}
          />
        </div>
        <label className="row field">
          <span className="field-label">Year</span>
          <input
            className="input"
            placeholder="None"
            value={draft.year}
            inputMode="numeric"
            onChange={(e) => edit({ year: e.target.value.replace(/\D/g, "").slice(0, 4) })}
          />
        </label>
      </Group>

      <Group footer={draft.published ? undefined : "Hidden from the site until this is on."}>
        <label className="row" htmlFor="show-on-site">
          <span className="row-text">Show on Site</span>
          <Switch
            id="show-on-site"
            label="Show on Site"
            checked={draft.published}
            onChange={(published) => edit({ published })}
          />
        </label>
        {loaded && shownOnSite(loaded.project) && (
          <a
            className="row link action"
            href={`${SITE_URL}/project/${encodeURIComponent(loaded.project.id)}`}
            target="_blank"
            rel="noreferrer"
          >
            <Icon name="open_in_new" />
            View on Site
          </a>
        )}
      </Group>

      <Group header="Collaborators">
        {credits.map((credit, i) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: rows have no identity beyond their place
          <div className="row credit-row" key={i}>
            <Combo
              label="Role"
              placeholder="Role"
              value={credit.role}
              options={roles}
              onChange={(role) => setCredit(i, { role })}
              onRemove={(role) => api.removeOption("roles", role).then(setOptions, () => {})}
            />
            <input
              className="input"
              aria-label="Name"
              placeholder="Name"
              value={credit.name}
              onChange={(e) => setCredit(i, { name: e.target.value })}
            />
            <button
              type="button"
              className="icon-button remove"
              aria-label={`Remove ${credit.name || "collaborator"}`}
              onClick={() => edit({ credits: credits.filter((_, j) => j !== i) })}
            >
              <Icon name="do_not_disturb_on" fill />
            </button>
          </div>
        ))}
        <button type="button" className="row action" onClick={() => edit({ credits: [...credits, { role: "", name: "" }] })}>
          <Icon name="add_circle" fill />
          Add Collaborator
        </button>
      </Group>

      <Group
        header="Images and Videos"
        footer="Drop files or folders here to add them."
        className={over ? "over" : undefined}
        onDragOver={(e) => {
          e.preventDefault();
          if (!saving) setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setOver(false);
          if (!saving) filesFromDrop(e.dataTransfer).then(add);
        }}
      >
        <button type="button" className="row action" disabled={!!saving} onClick={() => fileRef.current?.click()}>
          <Icon name="add_photo_alternate" />
          Add Images or Videos…
        </button>
        <button type="button" className="row action" disabled={!!saving} onClick={() => folderRef.current?.click()}>
          <Icon name="create_new_folder" />
          Add a Folder…
        </button>
        {draft.items.length > 0 && (
          <ol ref={listRef} onPointerMove={onDragMove}>
            {draft.items.map((item, index) => (
              <li key={item.id} className={dragging === item.id ? "dragging" : undefined}>
                <div className="row media-row">
                  <span className="number">{index + 1}</span>
                  <Thumb item={item} loaded={loaded} />
                  <span className="row-text">
                    <span className="file-name" title={item.file}>
                      {item.file}
                    </span>
                    <ItemMeta item={item} loaded={loaded} />
                  </span>
                  {item.type === "video" && loaded?.project.items.some((i) => i.id === item.id) && (
                    <button
                      type="button"
                      className="plain"
                      aria-label={`${hasPreview(item, loaded) ? "Edit" : "Create"} video preview for ${item.file}`}
                      onClick={() => navigate(`/cutter/${encodeURIComponent(loaded.project.id)}/${encodeURIComponent(item.id)}`)}
                    >
                      <Icon name={hasPreview(item, loaded) ? "edit" : "content_cut"} />
                      <span className="label">{hasPreview(item, loaded) ? "Edit Preview" : "Create Preview"}</span>
                    </button>
                  )}
                  <button
                    type="button"
                    className="icon-button"
                    disabled={!!saving}
                    aria-label={`Remove ${item.file}`}
                    onClick={() => edit({ items: draft.items.filter((i) => i.id !== item.id) })}
                  >
                    <Icon name="delete" />
                  </button>
                  <button
                    type="button"
                    className="icon-button handle"
                    disabled={!!saving}
                    aria-label={`Reorder ${item.file}. Use the up and down arrow keys.`}
                    onPointerDown={(e) => {
                      e.preventDefault();
                      e.currentTarget.setPointerCapture(e.pointerId);
                      setDragging(item.id);
                    }}
                    onPointerUp={() => setDragging(null)}
                    onPointerCancel={() => setDragging(null)}
                    onKeyDown={(e) => {
                      if (e.key === "ArrowUp") move(item.id, index - 1);
                      if (e.key === "ArrowDown") move(item.id, index + 1);
                    }}
                  >
                    <Icon name="menu" />
                  </button>
                </div>
              </li>
            ))}
          </ol>
        )}
      </Group>
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

      {loaded && (
        <Group>
          <button type="button" className="row destructive" onClick={() => setConfirming(true)}>
            Delete Project
          </button>
        </Group>
      )}
      {loaded && confirming && (
        <Alert
          title={`Delete “${loaded.project.name || "Untitled"}”?`}
          message="Its images, videos and previews are deleted too. This can’t be undone."
          confirm="Delete"
          onCancel={() => setConfirming(false)}
          onConfirm={async () => {
            try {
              await api.deleteProject(loaded.project.id);
              setDirty(false);
              navigate("/");
            } catch (e) {
              setConfirming(false);
              say(e instanceof Error ? e.message : String(e), true);
            }
          }}
        />
      )}
    </Page>
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
      <Icon name="play_arrow" fill className="badge" />
    </span>
  );
}

// A video has a preview once one is made, being made or waiting to be.
function hasPreview(item: Row, loaded: Loaded | null) {
  const id = previewStatusId(item.id);
  return !!loaded?.status[id] || !!loaded?.processing.includes(id);
}

// Where an item stands, in a word or two, or nothing for an image that's
// ready: the row only speaks up when something is still to happen or went
// wrong. A ready video says what its preview is.
function describe(item: Row, loaded: Loaded | null): { tone: Tone; text: string; why?: string } | null {
  const local = item.local;
  if (local?.state === "uploading") return { tone: "busy", text: `Uploading ${Math.floor(local.progress * 100)}%` };
  if (local?.state === "failed") return { tone: "error", text: "Upload Failed", why: local.error };
  const saved = loaded?.project.items.some((i) => i.id === item.id);
  if (!saved) return { tone: "wait", text: "Not Saved Yet" };
  const status = loaded?.status[item.id];
  if (item.copies || status?.state === "done") {
    if (item.type !== "video") return null;
    const preview = loaded?.status[previewStatusId(item.id)];
    if (loaded?.processing.includes(previewStatusId(item.id)) || preview?.state === "processing")
      return { tone: "busy", text: "Making Preview" };
    if (preview?.state === "failed") return { tone: "error", text: "Preview Failed", why: preview.message };
    if (preview?.state === "done") return { tone: "plain", text: preview.auto ? "Automatic Preview" : "Custom Preview" };
    return { tone: "plain", text: "No Preview" };
  }
  if (status?.state === "failed") return { tone: "error", text: "Couldn’t Process", why: status.message };
  if (status?.state === "processing") return { tone: "busy", text: item.type === "video" ? "Compressing" : "Processing" };
  if (loaded?.processing.includes(item.id)) return { tone: "wait", text: "Waiting" };
  return { tone: "wait", text: "Not Processed" };
}

// The line under the file name: kind, size and where it stands.
function ItemMeta({ item, loaded }: { item: Row; loaded: Loaded | null }) {
  const state = describe(item, loaded);
  return (
    <>
      <span className="meta">
        <span>
          {item.type === "video" ? "Video" : "Image"}
          {item.size ? ` · ${size(item.size)}` : ""}
        </span>
        {state && <State {...state} />}
      </span>
      {item.local?.state === "uploading" && <progress className="progress" value={item.local.progress} />}
    </>
  );
}
