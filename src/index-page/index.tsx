import * as React from "react";
import { ASPECTS, PROJECTS, type ProjectEntry } from "~/src/projects";
import styles from "./style.module.css";

/**
 * The index: the same projects the gallery holds, read as a list instead of a
 * space. One full-width row per project, title and year, on white. The active
 * row shows its images centred on screen, above every other row but under that
 * row itself: its name, year, playhead and line.
 *
 * Each row is also a player. Cursor x across the row maps to an image, so
 * sweeping left to right reads the whole album, and a square playhead on the
 * row's line follows the cursor exactly. A click plays a slideshow from the
 * image under the cursor: the square turns into a triangle running across the
 * row, and at the end of a project it carries on into the next one down the
 * list, for as long as the hand stays still. The index doesn't open projects.
 *
 * The gallery's split, carried over: the list sits at the bottom of the window,
 * and clicking a row raises it until that row's line is the centre line of the
 * window, where it stays. As a slideshow moves on, each next row rises onto the
 * line in turn. The list only ever moves while the hand is still, and the first
 * real movement stops the slideshow, so nothing moves under a moving cursor.
 * Clicking again, or the last project ending, stops it where it is; moving the
 * mouse stops it and the row under the cursor takes over.
 *
 * Going idle fades the other rows back to leave the picture clear, after Julia
 * Plaza (juliaplaza.com).
 *
 * With no row active, the preview isn't left empty for long: one image picked
 * at random shows when the page opens, and again AMBIENT_MS after the cursor
 * leaves the list (blank until then), fading in slowly since nobody is driving.
 * A stand-in until the gallery-to-index transition exists.
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
/** How the playhead settles onto the image showing when a slideshow stops where it is. */
const GLIDE = "350ms cubic-bezier(0.22, 1, 0.36, 1)";
/** Crossfade layers kept at once; only the oldest (already fading out) get cut. */
const MAX_LAYERS = 4;
/** The scrub dissolve in `style.module.css`: how fast a stopped slideshow's fades are cut short. */
const SCRUB_FADE_MS = 250;
/** The longest fade-out in `style.module.css`, plus slack: an outgoing layer is gone by then. */
const FADE_CLEANUP_MS = 2300;
/** How long with no pointer, wheel or key before the other rows fade back (Julia Plaza's 4s). */
const IDLE_MS = 4000;
/** After the cursor leaves the list, how long the preview stays blank before a random image. */
const AMBIENT_MS = 4000;

/** Where the preview is hidden, and with it the split: the list just sits centred. */
const NO_SPLIT = "(hover: none), (max-width: 53em)";

/** Every Work image, for the random picks. */
const ALL_IMAGES = PROJECTS.flatMap((project) => project.images);

/** Any Work image but `except`, so a new pick never repeats what was just on screen. */
function randomImage(except: string | null) {
  const pool = ALL_IMAGES.filter((url) => url !== except);
  return pool[Math.floor(Math.random() * pool.length)] ?? null;
}

/** Where the playhead sits, in cells (image i's centre is i + 0.5), and how it gets there. */
type Spot = { pos: number; transition: string };
/** A row, and the cursor's x across it. */
type Cursor = { index: number; el: HTMLElement; x: number };

export function IndexPage() {
  const projects = PROJECTS;
  /** The lit row: under the cursor, or the one a slideshow has carried on to. */
  const [active, setActive] = React.useState<number | null>(null);
  /** Where the playhead is heading, and how. */
  const [spot, setSpot] = React.useState<Spot>({ pos: 0.5, transition: "none" });
  /** Which image the preview is showing — follows the head after COMMIT_MS. */
  const [shown, setShown] = React.useState(0);
  const [playing, setPlaying] = React.useState(false);
  /** How far the list is raised, so the played row's line is the centre line. */
  const [lift, setLift] = React.useState(0);
  const idle = useIdle(IDLE_MS);
  /**
   * The image shown while no row is active: a random pick on arrival (at the
   * usual quick dissolve), and another AMBIENT_MS after leaving the list (slow).
   */
  const [ambient, setAmbient] = React.useState<{ src: string | null; slow: boolean } | null>(() => ({
    src: randomImage(null),
    slow: false,
  }));
  const ambientRef = React.useRef<number | null>(null);

  // The active row and head are mirrored in refs because two mousemoves can
  // land inside one render, and the slideshow's timer runs outside React: both
  // must read the latest, not a stale render's. The head is also where playback
  // starts, so a click mid-commit plays the image under the cursor.
  const activeRef = React.useRef<number | null>(null);
  const headRef = React.useRef(0);
  const commitRef = React.useRef<number | null>(null);
  const playRef = React.useRef<number | null>(null);
  const warmedRef = React.useRef<Set<string>>(new Set());
  /** Where the hand really is: the pointer's last position, from real movement only. */
  const handRef = React.useRef<{ x: number; y: number } | null>(null);
  /** Real pointer moves so far, and how many a row event has already answered. */
  const movesRef = React.useRef(0);
  const answeredRef = React.useRef(0);
  /** Where the cursor was when the slideshow started, to tell a twitch from a move. */
  const originRef = React.useRef<{ x: number; y: number } | null>(null);
  /** The click that started the slideshow, which mustn't also stop it. */
  const startClickRef = React.useRef<Event | null>(null);
  const listRef = React.useRef<HTMLUListElement>(null);
  /** The lift the list is settling to, where it stays once any slide is done. */
  const liftRef = React.useRef(0);
  const rowsRef = React.useRef<(HTMLButtonElement | null)[]>([]);

  const clearCommit = () => {
    if (commitRef.current !== null) window.clearTimeout(commitRef.current);
    commitRef.current = null;
  };
  const clearAmbient = () => {
    if (ambientRef.current !== null) window.clearTimeout(ambientRef.current);
    ambientRef.current = null;
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
      clearAmbient();
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
    clearAmbient();
    setAmbient(null);
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
    setSpot({ pos: f * n, transition: "none" });
    if (index !== activeRef.current) {
      activate(index, i);
      return;
    }
    if (i === headRef.current) return;
    headRef.current = i;
    clearCommit();
    commitRef.current = window.setTimeout(() => setShown(i), COMMIT_MS);
  };

  /** How far the list is raised right now, mid-slide included. */
  const raisedBy = () => {
    const list = listRef.current;
    return list ? -Number.parseFloat(getComputedStyle(list).top) || 0 : 0;
  };

  /**
   * The row under (x, y) where the list is settling. A hand that starts moving
   * mid-slide gets the row it will be over, not one passing under it.
   */
  const rowAt = (x: number, y: number) => {
    const shift = raisedBy() - liftRef.current;
    for (const [index, el] of rowsRef.current.entries()) {
      if (!el) continue;
      const r = el.getBoundingClientRect();
      if (x >= r.left && x < r.right && y >= r.top + shift && y < r.bottom + shift) return { index, el };
    }
    return null;
  };

  /** Raise (or lower) the list until this row's line is the centre line of the window. */
  const centre = (el: HTMLElement | null | undefined) => {
    if (!el || window.matchMedia(NO_SPLIT).matches) return;
    const lift = el.getBoundingClientRect().bottom + raisedBy() - window.innerHeight / 2;
    liftRef.current = lift;
    setLift(lift);
  };

  /** Stop where it is: the project and image stay, and the triangle settles back to a square. */
  const stopHere = () => {
    stopPlaying();
    setSpot({ pos: headRef.current + 0.5, transition: GLIDE });
  };

  /** No row under the cursor: blank for a moment, then something to look at again. */
  const endHover = () => {
    const index = activeRef.current;
    const last = index === null ? null : projects[index].images[headRef.current];
    clearCommit();
    activeRef.current = null;
    setActive(null);
    clearAmbient();
    ambientRef.current = window.setTimeout(() => setAmbient({ src: randomImage(last), slow: true }), AMBIENT_MS);
  };

  /** The hand moved: stop the slideshow, and the row under the cursor takes over. */
  const handBack = () => {
    const pointer = handRef.current;
    if (!pointer) {
      stopHere();
      return;
    }
    stopPlaying();
    const row = rowAt(pointer.x, pointer.y);
    if (!row) {
      endHover();
      return;
    }
    follow({ ...row, x: pointer.x });
    // Straight to the image under the cursor: the dwell is for sweeps, not a stop.
    clearCommit();
    setShown(headRef.current);
  };

  /**
   * Rows moving under a still hand fire mouse events too. A row event counts
   * only if the hand has really moved since the last one that did.
   */
  const handMoved = () => {
    if (answeredRef.current === movesRef.current) return false;
    answeredRef.current = movesRef.current;
    return true;
  };

  const onPointer = (e: React.MouseEvent) => {
    // While playing, the window watch decides (the cursor may be off the list).
    if (!handMoved() || playRef.current !== null) return;
    const row = rowAt(e.clientX, e.clientY);
    if (row) follow({ ...row, x: e.clientX });
    else if (activeRef.current !== null) endHover();
  };

  /**
   * While playing, the playhead travels at constant speed: through each image's
   * stay it glides from that image's centre to the next one's, arriving just as
   * the next image comes up — a timeline, not a row of steps.
   */
  const glideFrom = (i: number) => {
    const n = projects[activeRef.current ?? 0].images.length;
    setSpot({ pos: Math.min(i + 1.5, n), transition: `${PLAY_MS}ms linear` });
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
      stopHere();
      return;
    }
    // The next row lights up on its first image and rises onto the centre line,
    // replacing the last. Its playhead starts at that image rather than gliding
    // in from the left, and sets off once that has painted.
    activate(index + 1, 0);
    centre(rowsRef.current[index + 1]);
    setSpot({ pos: 0.5, transition: "none" });
    const id = playRef.current;
    requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        if (playRef.current === id) glideFrom(0);
      })
    );
  };

  /** Play from the image under the cursor, or, while playing, stop where it is. */
  const onClick = (e: React.MouseEvent<HTMLButtonElement>, index: number) => {
    if (playRef.current !== null) {
      stopHere();
      return;
    }
    // detail is 0 for a click from the keyboard, which has no cursor to measure.
    const origin = e.detail > 0 ? { x: e.clientX, y: e.clientY } : null;
    if (origin) {
      handRef.current = origin;
      follow({ index, el: e.currentTarget, x: origin.x });
    } else if (activeRef.current !== index) {
      activate(index, 0);
    }
    clearCommit();
    setShown(headRef.current);
    setPlaying(true);
    originRef.current = origin;
    glideFrom(headRef.current);
    playRef.current = window.setInterval(advance, PLAY_MS);
    // The played row rises until its line is the centre line of the window.
    centre(e.currentTarget);
    startClickRef.current = e.nativeEvent;
  };

  // The hand, watched at the window: the raised list can leave the cursor over
  // no row at all, where row events never fire.
  React.useEffect(() => {
    const listening = new AbortController();
    window.addEventListener(
      "pointermove",
      (move) => {
        const hand = handRef.current;
        if (hand && hand.x === move.clientX && hand.y === move.clientY) return;
        handRef.current = { x: move.clientX, y: move.clientY };
        movesRef.current += 1;
        if (playRef.current !== null) {
          // A still hand keeps it playing; a moving one takes over.
          const start = originRef.current;
          if (start && Math.hypot(move.clientX - start.x, move.clientY - start.y) <= TWITCH_PX) return;
          handBack();
          return;
        }
        // Off the rows, or moved off them: nothing to point at.
        if (activeRef.current !== null && !rowAt(move.clientX, move.clientY)) endHover();
      },
      { passive: true, signal: listening.signal }
    );
    // While playing, a click anywhere stops it where it is, even over no row.
    window.addEventListener(
      "click",
      (click) => {
        if (playRef.current !== null && click !== startClickRef.current) stopHere();
      },
      { signal: listening.signal }
    );
    return () => listening.abort();
  }, []);

  const current = active === null ? null : projects[active];
  // Covers and their siblings are the same files the canvas already fetched as
  // textures, so the swap comes out of the browser cache rather than the network.
  const src = current ? current.images[Math.min(shown, current.images.length - 1)] : (ambient?.src ?? null);

  return (
    <main className={styles.page}>
      <div className={styles.inner}>
        {/* Idle only counts while a row is active: with none, there's no picture to clear. */}
        <ul ref={listRef} className={`${styles.list} ${idle && active !== null ? styles.idle : ""}`} style={{ top: -lift }}>
          {projects.map((project, index) => (
            <li key={project.id}>
              <button
                ref={(el) => {
                  rowsRef.current[index] = el;
                }}
                type="button"
                className={`${styles.row} ${active === index ? styles.active : ""}`}
                aria-pressed={active === index && playing}
                onClick={(e) => onClick(e, index)}
                onMouseEnter={onPointer}
                onMouseMove={onPointer}
                // Keyboard focus lands on the project, not a position in it:
                // there is no cursor to read, so it starts at the first image.
                // A click focuses the row too, and handles itself.
                onFocus={(e) => {
                  if (!e.currentTarget.matches(":focus-visible") || activeRef.current === index) return;
                  stopPlaying();
                  activate(index, 0);
                  setSpot({ pos: 0.5, transition: "none" });
                }}
              >
                <span className={styles.title}>{project.title}</span>
                <span className={styles.year}>{project.year}</span>
                {active === index && <Playhead count={project.images.length} spot={spot} playing={playing} />}
              </button>
            </li>
          ))}
        </ul>
      </div>

      <div
        className={`${styles.preview} ${playing ? styles.previewPlaying : ""} ${!current && ambient?.slow ? styles.previewAmbient : ""}`}
        aria-hidden="true"
      >
        <Crossfade src={src} playing={playing} />
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
 * The playhead on the row's line: a square at the cursor while stopped, a
 * triangle running across the row while playing.
 */
function Playhead({ count, spot, playing }: { count: number; spot: Spot; playing: boolean }) {
  return (
    <span
      className={`${styles.playhead} ${playing ? styles.play : styles.stop}`}
      style={{
        left: `${(spot.pos / count) * 100}%`,
        transition: spot.transition === "none" ? "none" : `left ${spot.transition}`,
      }}
      aria-hidden="true"
    />
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
function Crossfade({ src, playing }: { src: string | null; playing: boolean }) {
  const [layers, setLayers] = React.useState<{ id: number; src: string; leaving: boolean }[]>([]);
  const nextId = React.useRef(0);
  const elsRef = React.useRef(new Map<number, HTMLImageElement>());

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

  // A slideshow fades its outgoing images over 2s. Stopped mid-fade, they would
  // linger for up to two seconds under the image the cursor brings back,
  // flashing an in-between image through and around it. So once playing stops,
  // any outgoing fade with longer than the scrub's to run is cut short: from
  // wherever it is to nothing in SCRUB_FADE_MS, falling fast.
  React.useEffect(() => {
    if (playing) return;
    for (const layer of layers) {
      const el = elsRef.current.get(layer.id);
      if (!layer.leaving || !el) continue;
      for (const fade of el.getAnimations()) {
        if (!(fade instanceof CSSTransition)) continue;
        const end = Number(fade.effect?.getComputedTiming().endTime ?? 0);
        const left = (end - Number(fade.currentTime ?? 0)) / fade.playbackRate;
        if (left <= SCRUB_FADE_MS) continue;
        const from = getComputedStyle(el).opacity;
        fade.cancel();
        el.animate([{ opacity: from }, { opacity: 0 }], { duration: SCRUB_FADE_MS, easing: "ease-out" }).onfinish = () =>
          setLayers((prev) => prev.filter((l) => l.id !== layer.id));
      }
    }
  }, [playing, layers]);

  return layers.map((layer) => (
    <img
      key={layer.id}
      ref={(el) => {
        if (el) elsRef.current.set(layer.id, el);
        else elsRef.current.delete(layer.id);
      }}
      src={`/${layer.src}`}
      alt=""
      decoding="async"
      className={`${styles.previewImg} ${layer.leaving ? styles.previewLeaving : ""}`}
      style={{ "--r": ASPECTS.get(layer.src) ?? 0.8 } as React.CSSProperties}
      onTransitionEnd={(e) => {
        if (layer.leaving && e.propertyName === "opacity") {
          setLayers((prev) => prev.filter((l) => l.id !== layer.id));
        }
      }}
    />
  ));
}
