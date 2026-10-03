import * as React from "react";
import { PROJECTS, type ProjectEntry } from "~/src/projects";
import styles from "./style.module.css";

/**
 * The index: the same projects the gallery holds, read as a list instead of a
 * space. One full-width row per project, title and year, on white. The active
 * row shows its images centred on screen, above every other row but under that
 * row itself: its name, year, playhead and lines.
 *
 * Each row is also a player. Cursor x across the row maps to an image, so
 * sweeping left to right reads the whole album, and a square playhead on the
 * row's line follows the cursor exactly. A click plays a slideshow from the
 * image under the cursor: the square turns into a triangle leading a grey bar
 * across the row, and at the end of a project it carries on into the next one
 * down the list, for as long as the hand stays still. Moving the mouse (past a
 * twitch), clicking again, or the last project ending hands back to the cursor:
 * the row under it, at its position. The index doesn't open projects.
 *
 * Going idle fades the other rows back to leave the picture clear, after Julia
 * Plaza (juliaplaza.com).
 */

/**
 * The playhead moves with the cursor; the picture waits this long before
 * following. At ten images across ~700px a fast sweep crosses a cell every
 * ~30ms, which strobes the whole album instead of showing you any of it. Ninety
 * milliseconds sits under the threshold where a deliberate placement feels
 * delayed, so it costs nothing when you stop and buys everything when you
 * don't. This is the number to turn if the scrub feels wrong.
 */
const COMMIT_MS = 90;
/** Slideshow pace while a row is playing (the owner found 1.5s too fast). */
const PLAY_MS = 3000;
/** How far the pointer can drift during a slideshow before it counts as moving and takes over. */
const TWITCH_PX = 10;
/** How a keyboard-played bar settles when stopped, with no cursor to return to. */
const GLIDE = "350ms cubic-bezier(0.22, 1, 0.36, 1)";
/** Crossfade layers kept at once; only the oldest (already fading out) get cut. */
const MAX_LAYERS = 4;
/** The longest fade-out in `style.module.css`, plus slack: an outgoing layer is gone by then. */
const FADE_CLEANUP_MS = 2300;
/** How long with no pointer, wheel or key before the other rows fade back (Julia Plaza's 4s). */
const IDLE_MS = 4000;

/** Where the playhead sits, in cells (image i's centre is i + 0.5), and how it gets there. */
type Bar = { pos: number; transition: string };
/** The cursor's last position, and the row it was over. */
type Cursor = { index: number; el: HTMLElement; x: number; y: number };

export function IndexPage() {
  const projects = PROJECTS;
  /** The lit row: under the cursor, or the one a slideshow has carried on to. */
  const [active, setActive] = React.useState<number | null>(null);
  /** Where the playhead and bar are heading, and how. */
  const [bar, setBar] = React.useState<Bar>({ pos: 0.5, transition: "none" });
  /** Which image the preview is showing — follows the head after COMMIT_MS. */
  const [shown, setShown] = React.useState(0);
  const [playing, setPlaying] = React.useState(false);
  const idle = useIdle(IDLE_MS);

  // The active row and head are mirrored in refs because two mousemoves can
  // land inside one render, and the slideshow's timer runs outside React: both
  // must read the latest, not a stale render's. The head is also where playback
  // starts, so a click mid-commit plays the image under the cursor.
  const activeRef = React.useRef<number | null>(null);
  const headRef = React.useRef(0);
  const commitRef = React.useRef<number | null>(null);
  const playRef = React.useRef<number | null>(null);
  const warmedRef = React.useRef<Set<string>>(new Set());
  /** What a slideshow hands back to when it stops. */
  const cursorRef = React.useRef<Cursor | null>(null);
  /** Where the cursor was when the slideshow started, to tell a twitch from a move. */
  const originRef = React.useRef<{ x: number; y: number } | null>(null);

  const clearCommit = () => {
    if (commitRef.current !== null) window.clearTimeout(commitRef.current);
    commitRef.current = null;
  };
  const stopPlaying = () => {
    if (playRef.current !== null) window.clearInterval(playRef.current);
    playRef.current = null;
    originRef.current = null;
    setPlaying(false);
  };
  React.useEffect(
    () => () => {
      clearCommit();
      if (playRef.current !== null) window.clearInterval(playRef.current);
    },
    []
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

  /** Light a row, showing image `head` straight away. */
  const activate = (index: number, head: number) => {
    clearCommit();
    activeRef.current = index;
    headRef.current = head;
    setActive(index);
    setShown(head);
    warm(projects[index]);
  };

  /**
   * Point the index at the cursor: the playhead sits exactly under it, and the
   * picture follows the cell it's in after COMMIT_MS. Measured live rather than
   * cached, so the mapping stays true if the list scrolls or the window resizes.
   */
  const follow = ({ index, el, x }: Cursor) => {
    const n = projects[index].images.length;
    const r = el.getBoundingClientRect();
    const f = Math.min(1, Math.max(0, (x - r.left) / r.width));
    const i = Math.min(n - 1, Math.floor(f * n));
    setBar({ pos: f * n, transition: "none" });
    if (index !== activeRef.current) {
      activate(index, i);
      return;
    }
    if (i === headRef.current) return;
    headRef.current = i;
    clearCommit();
    commitRef.current = window.setTimeout(() => setShown(i), COMMIT_MS);
  };

  /** Stop the slideshow and give the index back to the cursor, wherever it is now. */
  const handBack = () => {
    stopPlaying();
    if (cursorRef.current) {
      follow(cursorRef.current);
      return;
    }
    // Played from the keyboard: no cursor, so settle onto the image showing.
    setBar({ pos: headRef.current + 0.5, transition: GLIDE });
  };

  const onPointer = (e: React.MouseEvent<HTMLButtonElement>, index: number) => {
    const cursor = { index, el: e.currentTarget, x: e.clientX, y: e.clientY };
    cursorRef.current = cursor;
    if (playRef.current === null) {
      follow(cursor);
      return;
    }
    // A still hand keeps the slideshow going; a moving one takes over.
    const origin = originRef.current;
    if (origin && Math.hypot(cursor.x - origin.x, cursor.y - origin.y) <= TWITCH_PX) return;
    handBack();
  };

  /**
   * While playing, the bar travels at constant speed: through each image's stay
   * it glides from that image's centre to the next one's, arriving just as the
   * next image comes up — a timeline, not a row of steps.
   */
  const glideFrom = (i: number) => {
    const n = projects[activeRef.current ?? 0].images.length;
    setBar({ pos: Math.min(i + 1.5, n), transition: `${PLAY_MS}ms linear` });
  };

  /** One beat of the slideshow: the next image, the next project down the list, or the end. */
  const advance = () => {
    const index = activeRef.current;
    if (index === null) return;
    const next = headRef.current + 1;
    if (next < projects[index].images.length) {
      headRef.current = next;
      setShown(next);
      glideFrom(next);
      return;
    }
    if (index + 1 >= projects.length) {
      handBack();
      return;
    }
    // The next row lights up on its first image. Its bar starts there rather
    // than gliding in from the left, and sets off once that has painted.
    activate(index + 1, 0);
    setBar({ pos: 0.5, transition: "none" });
    const id = playRef.current;
    requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        if (playRef.current === id) glideFrom(0);
      })
    );
  };

  /** Play from the image under the cursor, or, while playing, hand back. */
  const onClick = (e: React.MouseEvent<HTMLButtonElement>, index: number) => {
    if (playRef.current !== null) {
      handBack();
      return;
    }
    // detail is 0 for a click from the keyboard, which has no cursor to measure.
    const origin = e.detail > 0 ? { x: e.clientX, y: e.clientY } : null;
    if (origin) {
      cursorRef.current = { index, el: e.currentTarget, ...origin };
      follow(cursorRef.current);
    } else if (activeRef.current !== index) {
      activate(index, 0);
    }
    clearCommit();
    setShown(headRef.current);
    setPlaying(true);
    originRef.current = origin;
    glideFrom(headRef.current);
    playRef.current = window.setInterval(advance, PLAY_MS);
  };

  const leave = () => {
    clearCommit();
    stopPlaying();
    cursorRef.current = null;
    activeRef.current = null;
    setActive(null);
  };

  const current = active === null ? null : projects[active];
  // Covers and their siblings are the same files the canvas already fetched as
  // textures, so the swap comes out of the browser cache rather than the network.
  const src = current ? current.images[Math.min(shown, current.images.length - 1)] : null;

  return (
    <main className={styles.page}>
      <div className={styles.inner}>
        {/* biome-ignore lint/a11y/noNoninteractiveElementInteractions: clearing hover state on leave */}
        {/* Idle only counts while a row is active: with none, there's no picture to clear. */}
        <ul className={`${styles.list} ${idle && active !== null ? styles.idle : ""}`} onMouseLeave={leave}>
          {projects.map((project, index) => (
            <li key={project.id}>
              <button
                type="button"
                className={`${styles.row} ${active === index ? styles.active : ""}`}
                aria-pressed={active === index && playing}
                onClick={(e) => onClick(e, index)}
                onMouseEnter={(e) => onPointer(e, index)}
                onMouseMove={(e) => onPointer(e, index)}
                // Keyboard focus lands on the project, not a position in it:
                // there is no cursor to read, so it starts at the first image.
                // A click focuses the row too, and handles itself.
                onFocus={(e) => {
                  if (!e.currentTarget.matches(":focus-visible") || activeRef.current === index) return;
                  stopPlaying();
                  activate(index, 0);
                  setBar({ pos: 0.5, transition: "none" });
                }}
              >
                <span className={styles.title}>{project.title}</span>
                <span className={styles.year}>{project.year}</span>
                {active === index && <Playhead count={project.images.length} bar={bar} playing={playing} />}
              </button>
            </li>
          ))}
        </ul>
      </div>

      <div className={`${styles.preview} ${playing ? styles.previewPlaying : ""}`} aria-hidden="true">
        <Crossfade src={src} />
      </div>
    </main>
  );
}

/**
 * True once there has been no pointer movement, click, wheel or key for `ms`;
 * false again on the next one. Each event restarts the countdown, so a still
 * hand reads as idle even mid-slideshow.
 */
function useIdle(ms: number) {
  const [idle, setIdle] = React.useState(false);
  React.useEffect(() => {
    const listening = new AbortController();
    let timer = window.setTimeout(() => setIdle(true), ms);
    const wake = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => setIdle(true), ms);
      setIdle(false);
    };
    for (const type of ["pointermove", "pointerdown", "wheel", "keydown"]) {
      window.addEventListener(type, wake, { passive: true, signal: listening.signal });
    }
    return () => {
      listening.abort();
      window.clearTimeout(timer);
    };
  }, [ms]);
  return idle;
}

/**
 * The row as a player: the playhead on the row's line, a square at the cursor
 * while stopped and a triangle while playing, and while playing a grey bar from
 * the left edge to it.
 */
function Playhead({ count, bar, playing }: { count: number; bar: Bar; playing: boolean }) {
  const at = `${(bar.pos / count) * 100}%`;
  const via = (property: string) => (bar.transition === "none" ? "none" : `${property} ${bar.transition}`);
  return (
    <>
      <span
        className={`${styles.progress} ${playing ? styles.progressPlaying : ""}`}
        style={{ width: at, transition: via("width") }}
        aria-hidden="true"
      />
      <span
        className={`${styles.playhead} ${playing ? styles.play : styles.stop}`}
        style={{ left: at, transition: via("left") }}
        aria-hidden="true"
      />
    </>
  );
}

/**
 * Image changes crossfade, after Estudio Além (estudioalem.com), whose loop is
 * Swiper's `fade` effect: images stacked in one place, the incoming fading in
 * over the outgoing. The timing lives in CSS. While playing it's a long 2s
 * crossfade that keeps the double exposure — the owner tried a cleaner dissolve
 * and preferred this to the lift towards white it caused. While scrubbing it's a
 * quick dissolve that keeps up with the cursor.
 */
function Crossfade({ src }: { src: string | null }) {
  const [layers, setLayers] = React.useState<{ id: number; src: string; leaving: boolean }[]>([]);
  const nextId = React.useRef(0);

  React.useEffect(() => {
    setLayers((prev) => {
      const top = prev.at(-1);
      if (top && !top.leaving && top.src === src) return prev;
      const outgoing = prev.map((layer) => (layer.leaving ? layer : { ...layer, leaving: true }));
      if (!src) return outgoing;
      nextId.current += 1;
      return [...outgoing, { id: nextId.current, src, leaving: false }].slice(-MAX_LAYERS);
    });
    // transitionend doesn't fire for a layer that was still invisible when it
    // started leaving (nothing to fade), so sweep anything left fading out.
    const sweep = window.setTimeout(() => setLayers((prev) => prev.filter((layer) => !layer.leaving)), FADE_CLEANUP_MS);
    return () => window.clearTimeout(sweep);
  }, [src]);

  return layers.map((layer) => (
    <img
      key={layer.id}
      src={`/${layer.src}`}
      alt=""
      decoding="async"
      className={`${styles.previewImg} ${layer.leaving ? styles.previewLeaving : ""}`}
      onTransitionEnd={(e) => {
        if (layer.leaving && e.propertyName === "opacity") {
          setLayers((prev) => prev.filter((l) => l.id !== layer.id));
        }
      }}
    />
  ));
}
