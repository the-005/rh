import * as React from "react";
import { PROJECTS, type ProjectEntry } from "~/src/projects";
import styles from "./style.module.css";

/**
 * The index: the same projects the gallery holds, read as a list instead of a
 * space. One row per project — number, title, year — on the white the project
 * page already uses, so the toggle reads as canvas → paper. The list keeps to
 * the left half; hovering a row shows that project's cover in the right.
 *
 * Each row is also a timeline. Cursor x across the row maps to an image in that
 * project, so the row's middle is the album's middle: sweeping left to right
 * reads the whole project without opening it. The row's own hairline is the
 * track — ticks divide it into one cell per image, a marker snaps to the cell
 * under the cursor, and a counter reads it back. Clicking opens the project on
 * whichever image the marker is on, which ProjectPage already supports through
 * `startIndex`.
 */

/**
 * The head moves with the cursor; the picture waits this long before following.
 * At ten images across ~700px a fast sweep crosses a cell every ~30ms, which
 * strobes the whole album instead of showing you any of it. Ninety milliseconds
 * sits under the threshold where a deliberate placement feels delayed, so it
 * costs nothing when you stop and buys everything when you don't. This is the
 * number to turn if the scrub feels wrong.
 */
const COMMIT_MS = 90;

export function IndexPage({
  category,
  onOpenProject,
}: {
  category: string;
  onOpenProject: (id: string, startIndex: number) => void;
}) {
  const projects = category === "all" ? PROJECTS : PROJECTS.filter((p) => p.category === category);
  const [hovered, setHovered] = React.useState<string | null>(null);
  /** Where the marker sits — moves the instant you cross a cell. */
  const [head, setHead] = React.useState(0);
  /** Which image the preview is showing — follows the head after COMMIT_MS. */
  const [shown, setShown] = React.useState(0);

  // The head is mirrored in a ref because two mousemoves can land inside one
  // render, and the second must compare against the first, not the stale prop.
  // It is also what a click reads: the marker is the promise, so clicking
  // mid-commit must open the image under the head, not the last one committed.
  const headRef = React.useRef(0);
  const commitRef = React.useRef<number | null>(null);
  const warmedRef = React.useRef<Set<string>>(new Set());

  const clearCommit = () => {
    if (commitRef.current !== null) window.clearTimeout(commitRef.current);
    commitRef.current = null;
  };
  React.useEffect(() => clearCommit, []);

  /**
   * The canvas has already fetched most of these as textures, so this mostly
   * costs nothing — but a project you have never panned past would otherwise
   * stutter on its first scrub while each image fetches in turn.
   */
  const warm = (project: ProjectEntry) => {
    if (warmedRef.current.has(project.id)) return;
    warmedRef.current.add(project.id);
    for (const url of project.images) {
      const img = new Image();
      img.src = `/${url}`;
    }
  };

  const enter = (project: ProjectEntry) => {
    clearCommit();
    headRef.current = 0;
    setHovered(project.id);
    setHead(0);
    setShown(0);
    warm(project);
  };

  const scrub = (e: React.MouseEvent<HTMLButtonElement>, project: ProjectEntry) => {
    const n = project.images.length;
    // Measured live rather than cached on enter: the row itself slides
    // `translateX(0.5rem)` on hover, and the track rides along with it, so a
    // rect captured before the slide would be off by that much for the whole
    // sweep. Reading it per move keeps the mapping true to where the row is.
    const r = e.currentTarget.getBoundingClientRect();
    const i = Math.min(n - 1, Math.max(0, Math.floor(((e.clientX - r.left) / r.width) * n)));
    if (i === headRef.current) return;
    headRef.current = i;
    setHead(i);
    clearCommit();
    commitRef.current = window.setTimeout(() => setShown(i), COMMIT_MS);
  };

  const leave = () => {
    clearCommit();
    setHovered(null);
  };

  const active = projects.find((p) => p.id === hovered);
  // Covers and their siblings are the same files the canvas already fetched as
  // textures, so the swap comes out of the browser cache rather than the network.
  const src = active ? active.images[Math.min(shown, active.images.length - 1)] : null;

  return (
    <main className={styles.page}>
      <div className={styles.inner}>
        <div className={styles.head}>
          <span>#</span>
          <span>Title</span>
          <span className={styles.year}>Year</span>
        </div>

        {/* biome-ignore lint/a11y/noNoninteractiveElementInteractions: clearing hover state on leave */}
        <ul className={styles.list} onMouseLeave={leave}>
          {projects.map((project, i) => (
            <li key={project.id}>
              <button
                type="button"
                className={styles.row}
                onClick={() => onOpenProject(project.id, headRef.current)}
                onMouseEnter={() => enter(project)}
                onMouseMove={(e) => scrub(e, project)}
                // Keyboard focus lands on the project, not a position in it —
                // there is no cursor to read, so the row opens at its first
                // image the way it always has.
                onFocus={() => {
                  if (hovered === project.id) return;
                  enter(project);
                }}
              >
                <span className={styles.num}>{String(i + 1).padStart(2, "0")}</span>
                <span className={styles.title}>{project.title}</span>
                <span className={styles.year}>{project.year}</span>
                {hovered === project.id && <Track project={project} head={head} />}
              </button>
            </li>
          ))}
        </ul>
      </div>

      <div className={styles.preview} aria-hidden="true">
        {/* Keyed by project, not by url: scrubbing swaps the src in place so the
            fade plays once on arrival instead of re-firing on every cell. */}
        {src && <img key={hovered} src={`/${src}`} alt="" className={styles.previewImg} decoding="async" />}
      </div>
    </main>
  );
}

/** The row's hairline, read as a filmstrip: one cell per image, head on top. */
function Track({ project, head }: { project: ProjectEntry; head: number }) {
  const n = project.images.length;
  const at = `${((head + 0.5) / n) * 100}%`;

  return (
    <span className={styles.track} aria-hidden="true">
      {Array.from({ length: n + 1 }, (_, i) => (
        <span
          key={project.images[i] ?? "end"}
          className={`${styles.tick} ${i <= head ? styles.tickPast : ""}`}
          style={{ left: `${(i / n) * 100}%` }}
        />
      ))}
      <span className={styles.marker} style={{ left: at }} />
      <span className={styles.counter} style={{ left: at }}>
        {String(head + 1).padStart(2, "0")} / {n}
      </span>
    </span>
  );
}
