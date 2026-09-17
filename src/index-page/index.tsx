import * as React from "react";
import { PROJECTS, type ProjectEntry } from "~/src/projects";
import styles from "./style.module.css";

/**
 * The index: the same projects the gallery holds, read as a list instead of a
 * space. One full-width row per project, title and year, on white. Hovering a
 * row shows its images centred on screen, above every other row but under that
 * row's own name and year.
 *
 * Each row is also a player. Cursor x across the row maps to an image, so
 * sweeping left to right reads the whole album. A grey bar fills the row from
 * its left edge to the current image, ending at the centre of the playhead
 * sitting on the row's line: a square while stopped, a triangle while playing.
 * Clicking the row plays the album as a slideshow from there (looping) or stops
 * it. While it plays the cursor doesn't scrub, so the slideshow isn't knocked
 * about by a twitch of the hand. The index doesn't open projects.
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
/** Slideshow pace while a row is playing. */
const PLAY_MS = 1500;

export function IndexPage() {
  const projects = PROJECTS;
  const [hovered, setHovered] = React.useState<string | null>(null);
  /** Where the playhead sits — moves the instant you cross a cell. */
  const [head, setHead] = React.useState(0);
  /** Which image the preview is showing — follows the head after COMMIT_MS. */
  const [shown, setShown] = React.useState(0);
  const [playing, setPlaying] = React.useState(false);

  // The head is mirrored in a ref because two mousemoves can land inside one
  // render, and the second must compare against the first, not the stale prop.
  // It is also where playback starts: clicking mid-commit plays from the image
  // under the playhead, not the last one committed.
  const headRef = React.useRef(0);
  const commitRef = React.useRef<number | null>(null);
  const playRef = React.useRef<number | null>(null);
  const warmedRef = React.useRef<Set<string>>(new Set());

  const clearCommit = () => {
    if (commitRef.current !== null) window.clearTimeout(commitRef.current);
    commitRef.current = null;
  };
  const stop = () => {
    if (playRef.current !== null) window.clearInterval(playRef.current);
    playRef.current = null;
    setPlaying(false);
  };
  React.useEffect(
    () => () => {
      clearCommit();
      if (playRef.current !== null) window.clearInterval(playRef.current);
    },
    [],
  );

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
    stop();
    headRef.current = 0;
    setHovered(project.id);
    setHead(0);
    setShown(0);
    warm(project);
  };

  const scrub = (e: React.MouseEvent<HTMLButtonElement>, project: ProjectEntry) => {
    if (playRef.current !== null) return;
    const n = project.images.length;
    // Measured live rather than cached on enter, so the mapping stays true if
    // the list scrolls or the window resizes mid-sweep.
    const r = e.currentTarget.getBoundingClientRect();
    const i = Math.min(n - 1, Math.max(0, Math.floor(((e.clientX - r.left) / r.width) * n)));
    if (i === headRef.current) return;
    headRef.current = i;
    setHead(i);
    clearCommit();
    commitRef.current = window.setTimeout(() => setShown(i), COMMIT_MS);
  };

  /** Play from the current image, or stop where it is. */
  const toggle = (project: ProjectEntry) => {
    if (hovered !== project.id) enter(project);
    if (playRef.current !== null) {
      stop();
      return;
    }
    clearCommit();
    setShown(headRef.current);
    setPlaying(true);
    const n = project.images.length;
    playRef.current = window.setInterval(() => {
      const next = (headRef.current + 1) % n;
      headRef.current = next;
      setHead(next);
      setShown(next);
    }, PLAY_MS);
  };

  const leave = () => {
    clearCommit();
    stop();
    setHovered(null);
  };

  const active = projects.find((p) => p.id === hovered);
  // Covers and their siblings are the same files the canvas already fetched as
  // textures, so the swap comes out of the browser cache rather than the network.
  const src = active ? active.images[Math.min(shown, active.images.length - 1)] : null;

  return (
    <main className={styles.page}>
      <div className={styles.inner}>
        {/* biome-ignore lint/a11y/noNoninteractiveElementInteractions: clearing hover state on leave */}
        <ul className={styles.list} onMouseLeave={leave}>
          {projects.map((project) => (
            <li key={project.id}>
              <button
                type="button"
                className={styles.row}
                aria-pressed={hovered === project.id && playing}
                onClick={() => toggle(project)}
                onMouseEnter={() => enter(project)}
                onMouseMove={(e) => scrub(e, project)}
                // Keyboard focus lands on the project, not a position in it —
                // there is no cursor to read, so it starts at the first image.
                onFocus={() => {
                  if (hovered === project.id) return;
                  enter(project);
                }}
              >
                <span className={styles.title}>{project.title}</span>
                <span className={styles.year}>{project.year}</span>
                {hovered === project.id && <Playhead project={project} head={head} playing={playing} />}
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

/**
 * The row as a progress bar: a grey fill from the left edge to the centre of
 * the current image's cell, and the playhead sitting on the row's line at that
 * point — a triangle while playing, a square while stopped.
 */
function Playhead({ project, head, playing }: { project: ProjectEntry; head: number; playing: boolean }) {
  const at = `${((head + 0.5) / project.images.length) * 100}%`;
  return (
    <>
      <span className={styles.progress} style={{ width: at }} aria-hidden="true" />
      <span className={`${styles.playhead} ${playing ? styles.play : styles.stop}`} style={{ left: at }} aria-hidden="true" />
    </>
  );
}
