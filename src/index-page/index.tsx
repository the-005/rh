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
 * The gallery's split, carried over: the list opens centred in the window, and
 * clicking a row moves it until that row's line is the centre line of the
 * window, where it stays. As a slideshow moves on, each next row rises onto the
 * line in turn. The list only ever moves while the hand is still, and the first
 * real movement stops the slideshow, so nothing moves under a moving cursor.
 * Clicking again (anywhere), or the last project ending, stops it exactly where
 * it is, and while the hand stays still another click carries on from there;
 * moving the mouse, or scrolling, stops it and the row under the cursor takes
 * over.
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
/**
 * How long the list takes to bring a row onto the centre line: one row's move
 * (a step of the reel) takes LIFT_ROW_MS, and farther moves take longer, by the
 * square root of the distance, up to LIFT_MAX_MS. One fixed time made a ten-row
 * move ten times faster than a one-row step.
 */
const LIFT_ROW_MS = 500;
const LIFT_MAX_MS = 1500;
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

/**
 * `?rows=40` repeats the projects to that many rows, to see how the index
 * behaves once there are more projects than fit. A test aid; nothing links to it.
 */
function listedProjects(): ProjectEntry[] {
  const rows = Number(new URLSearchParams(window.location.search).get("rows"));
  if (!(rows > PROJECTS.length)) return PROJECTS;
  return Array.from({ length: Math.min(rows, 500) }, (_, i) => PROJECTS[i % PROJECTS.length]);
}

/** The site's row-move curve, cubic-bezier(0.42, 0, 0.58, 1), for the list's moves, which run in script. */
function rowMoveEase(t: number) {
  const x = (u: number) => 3 * 0.42 * u * (1 - u) ** 2 + 3 * 0.58 * u ** 2 * (1 - u) + u ** 3;
  let lo = 0;
  let hi = 1;
  for (let i = 0; i < 24; i++) {
    const mid = (lo + hi) / 2;
    if (x(mid) < t) lo = mid;
    else hi = mid;
  }
  const u = (lo + hi) / 2;
  return 3 * u * u - 2 * u * u * u;
}

/** Every Work image, for the random picks. */
const ALL_IMAGES = PROJECTS.flatMap((project) => project.images);

/** Any Work image but `except`, so a new pick never repeats what was just on screen. */
function randomImage(except: string | null) {
  const pool = ALL_IMAGES.filter((url) => url !== except);
  return pool[Math.floor(Math.random() * pool.length)] ?? null;
}

/** Where the playhead sits, in images (image i has the stretch from i to i + 1), and how it gets there. */
type Spot = { pos: number; transition: string };
/** A row, and the cursor's x across it. */
type Cursor = { index: number; el: HTMLElement; x: number };

export function IndexPage() {
  const [projects] = React.useState(listedProjects);
  /** The lit row: under the cursor, or the one a slideshow has carried on to. */
  const [active, setActive] = React.useState<number | null>(null);
  /** Where the playhead is heading, and how. */
  const [spot, setSpot] = React.useState<Spot>({ pos: 0.5, transition: "none" });
  /** Which image the preview is showing — follows the head after COMMIT_MS. */
  const [shown, setShown] = React.useState(0);
  const [playing, setPlaying] = React.useState(false);
  /** How far the list is raised, so the played row's line is the centre line. */
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
  /** Where the cursor was when the slideshow started, to tell a twitch from a move. */
  const originRef = React.useRef<{ x: number; y: number } | null>(null);
  /** The last click a row answered, so the window doesn't answer it again. */
  const answeredClickRef = React.useRef<Event | null>(null);
  /**
   * A slideshow stopped where it is: until the hand moves, a click carries on.
   * `at` is where the hand was when it stopped (null if played by keyboard).
   */
  const pausedRef = React.useRef<{ at: { x: number; y: number } | null } | null>(null);
  /** Mirrors pausedRef for the styles: a stopped row stays as quiet as a playing one. */
  const [stoppedHere, setStoppedHere] = React.useState(false);
  const setPaused = (paused: { at: { x: number; y: number } | null } | null) => {
    pausedRef.current = paused;
    setStoppedHere(paused !== null);
  };
  const mainRef = React.useRef<HTMLElement>(null);
  const listRef = React.useRef<HTMLUListElement>(null);
  /**
   * Where the list is headed: `scroll`, the page's scroll position, and
   * `shift`, how far the list is drawn below its place (never above). Raising
   * a row onto the centre line is a scroll, so the page always knows where the
   * rows are and every one can be scrolled back to. Only bringing a row down
   * at the very top, where there's nothing to scroll, is a shift.
   */
  const aimRef = React.useRef({ scroll: 0, shift: 0 });
  /** The shift as drawn right now, mid-move included. */
  const shiftRef = React.useRef(0);
  /**
   * Room below the list beyond the page's own end: only as much as a raised
   * row needs to reach the centre line, and it melts away as the user scrolls
   * back up. At rest there's none, so the page ends at the last row.
   */
  const roomRef = React.useRef(0);
  const roomElRef = React.useRef<HTMLDivElement>(null);
  const innerRef = React.useRef<HTMLDivElement>(null);
  /** The scroll position the list's own move last set, to tell it from the user's. */
  const ownScrollRef = React.useRef<number | null>(null);
  /** Where the user last left the page by scrolling it themselves, which a reset keeps. */
  const userScrollRef = React.useRef(0);
  const moveRef = React.useRef<number | null>(null);
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
      if (moveRef.current !== null) cancelAnimationFrame(moveRef.current);
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
    setPaused(null);
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

  /** How far a row on screen now will be from here once the list has arrived. */
  const toAim = () => {
    const scroll = mainRef.current?.scrollTop ?? 0;
    return scroll - aimRef.current.scroll + (aimRef.current.shift - shiftRef.current);
  };

  const drawShift = (px: number) => {
    shiftRef.current = px;
    if (listRef.current) listRef.current.style.top = `${px}px`;
  };

  /** Stop the list where it is, mid-move or not. */
  const holdList = () => {
    if (moveRef.current !== null) cancelAnimationFrame(moveRef.current);
    moveRef.current = null;
    aimRef.current = { scroll: mainRef.current?.scrollTop ?? 0, shift: shiftRef.current };
  };

  /** The room below the list needed to scroll to `scroll`: none within the page's own end. */
  const roomFor = (scroll: number) => {
    const main = mainRef.current;
    const inner = innerRef.current;
    if (!main || !inner) return 0;
    return Math.max(0, scroll - (inner.offsetHeight - main.clientHeight));
  };

  const setRoom = (px: number) => {
    roomRef.current = px;
    if (roomElRef.current) roomElRef.current.style.height = `${px}px`;
  };

  /** Move the list to `aim` over `ms`, scroll and shift together, on the row-move curve. */
  const moveList = (aim: { scroll: number; shift: number }, ms: number) => {
    const main = mainRef.current;
    if (!main) return;
    if (moveRef.current !== null) cancelAnimationFrame(moveRef.current);
    aimRef.current = aim;
    // Room for the whole way there (shrinking it mid-move would clip the scroll),
    // trimmed to what the end needs once it's arrived.
    setRoom(Math.max(roomRef.current, roomFor(aim.scroll)));
    const from = { scroll: main.scrollTop, shift: shiftRef.current };
    const start = performance.now();
    const step = (now: number) => {
      const k = Math.min(1, (now - start) / ms);
      const eased = rowMoveEase(k);
      main.scrollTop = from.scroll + (aim.scroll - from.scroll) * eased;
      ownScrollRef.current = main.scrollTop;
      drawShift(k < 1 ? from.shift + (aim.shift - from.shift) * eased : aim.shift);
      moveRef.current = k < 1 ? requestAnimationFrame(step) : null;
      if (k === 1) setRoom(roomFor(aim.scroll));
    };
    moveRef.current = requestAnimationFrame(step);
  };

  /**
   * The row under (x, y) where the list is settling. A hand that starts moving
   * mid-slide gets the row it will be over, not one passing under it.
   */
  const rowAt = (x: number, y: number) => {
    // At rest, whatever is really under the cursor: a nav button over a row
    // in a long list is the nav, not the row.
    if (moveRef.current === null) {
      const hit = document.elementFromPoint(x, y)?.closest("button");
      const index = hit ? rowsRef.current.indexOf(hit as HTMLButtonElement) : -1;
      return index >= 0 ? { index, el: rowsRef.current[index] as HTMLButtonElement } : null;
    }
    const shift = toAim();
    for (const [index, el] of rowsRef.current.entries()) {
      if (!el) continue;
      const r = el.getBoundingClientRect();
      if (x >= r.left && x < r.right && y >= r.top + shift && y < r.bottom + shift) return { index, el };
    }
    return null;
  };

  /** Move the list until this row's line is the centre line of the window. */
  const centre = (el: HTMLElement | null | undefined) => {
    const main = mainRef.current;
    if (!el || !main || window.matchMedia(NO_SPLIT).matches) return;
    // How far below the centre line the row's line will be, once the list has arrived.
    const by = el.getBoundingClientRect().bottom + toAim() - window.innerHeight / 2;
    const raised = aimRef.current.scroll - aimRef.current.shift + by;
    // Up is a scroll (growing room below if the page ends too soon); down past
    // the top is a shift.
    const aim = raised >= 0 ? { scroll: raised, shift: 0 } : { scroll: 0, shift: -raised };
    const rows = Math.abs(by) / el.offsetHeight;
    moveList(aim, Math.min(LIFT_MAX_MS, LIFT_ROW_MS * Math.sqrt(Math.max(1, rows))));
  };

  /** Where the playhead is drawn right now, mid-glide included, in cells. */
  const spotNow = () => {
    const index = activeRef.current;
    const row = index === null ? null : rowsRef.current[index];
    const mark = row?.querySelector<HTMLElement>(`.${styles.playhead}`);
    if (index === null || !row || !mark) return headRef.current + 0.5;
    return (Number.parseFloat(getComputedStyle(mark).left) / row.clientWidth) * projects[index].images.length;
  };

  /**
   * Stop exactly where it is: the project and image stay, and the playhead
   * freezes on the spot, a square now. Until the hand moves, a click carries on.
   */
  const stopHere = () => {
    const pos = spotNow();
    stopPlaying();
    setSpot({ pos, transition: "none" });
    setPaused({ at: handRef.current });
  };

  /**
   * Run the slideshow from `at`, a point in the current image's stretch of the
   * row: the playhead carries on at the slideshow's speed (one image's stretch
   * per PLAY_MS) to the end of that stretch, where the next image comes up, and
   * then beats every PLAY_MS. Starting mid-image is starting mid-way through it.
   */
  const runFrom = (at: number) => {
    const end = headRef.current + 1;
    const left = Math.max(0, end - at) * PLAY_MS;
    setPlaying(true);
    setSpot({ pos: end, transition: `${left}ms linear` });
    playRef.current = window.setTimeout(() => {
      playRef.current = window.setInterval(advance, PLAY_MS);
      advance();
    }, left);
  };

  /** Carry on from exactly where it stopped, as if it never had. */
  const resume = () => {
    setPaused(null);
    if (activeRef.current === null) return;
    originRef.current = handRef.current;
    runFrom(spotNow());
  };

  /** No row under the cursor: blank for a moment, then something to look at again. */
  const endHover = () => {
    const index = activeRef.current;
    const last = index === null ? null : projects[index].images[headRef.current];
    clearCommit();
    setPaused(null);
    activeRef.current = null;
    setActive(null);
    clearAmbient();
    ambientRef.current = window.setTimeout(() => {
      setAmbient({ src: randomImage(last), slow: true });
      settleList();
    }, AMBIENT_MS);
  };

  /**
   * After a while with no row under the cursor, the list goes back to where the
   * user last left it themselves, undoing only what clicks and the reel moved:
   * a short list is centred again, as on landing, and a long one keeps the
   * user's own place. Any room below melts away with it.
   */
  const settleList = () => {
    const main = mainRef.current;
    const inner = innerRef.current;
    if (!main || !inner) return;
    const end = Math.max(0, inner.offsetHeight - main.clientHeight);
    const aim = { scroll: Math.min(userScrollRef.current, end), shift: 0 };
    const now = aimRef.current;
    const by = Math.abs(now.scroll - now.shift - aim.scroll);
    if (by < 1) return;
    const rows = by / (rowsRef.current[0]?.offsetHeight || 1);
    moveList(aim, Math.min(LIFT_MAX_MS, LIFT_ROW_MS * Math.sqrt(Math.max(1, rows))));
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
   * The row is the project's timeline, edge to edge: each image has its own
   * stretch of it, and while playing the playhead crosses image i's stretch at
   * constant speed during that image's stay, so it is always over the image
   * showing (as the cursor is when hovering).
   */
  const glideThrough = (i: number) => {
    setSpot({ pos: i + 1, transition: `${PLAY_MS}ms linear` });
  };

  /** One beat of the slideshow: the next image, the next project down the list, or the end. */
  const advance = () => {
    const index = activeRef.current;
    if (index === null) return;
    const next = headRef.current + 1;
    if (next < projects[index].images.length) {
      headRef.current = next;
      setShown(next);
      glideThrough(next);
      return;
    }
    if (index + 1 >= projects.length) {
      stopHere();
      return;
    }
    // The next row lights up on its first image and rises onto the centre line,
    // replacing the last. Its playhead starts at the left edge, the start of its
    // timeline, and sets off once that has painted.
    activate(index + 1, 0);
    centre(rowsRef.current[index + 1]);
    setSpot({ pos: 0, transition: "none" });
    const id = playRef.current;
    requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        if (playRef.current === id) glideThrough(0);
      })
    );
  };

  /** Play from the image under the cursor, or, while playing, stop where it is. */
  const onClick = (e: React.MouseEvent<HTMLButtonElement>, index: number) => {
    answeredClickRef.current = e.nativeEvent;
    if (playRef.current !== null) {
      stopHere();
      return;
    }
    if (pausedRef.current) {
      resume();
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
    originRef.current = origin;
    // From the click's point on the timeline; from the image's start by keyboard.
    const r = e.currentTarget.getBoundingClientRect();
    const n = projects[index].images.length;
    runFrom(origin ? Math.min(n, Math.max(0, ((origin.x - r.left) / r.width) * n)) : headRef.current);
    // The played row rises until its line is the centre line of the window.
    centre(e.currentTarget);
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
        // Stopped where it was: a still hand can carry on with a click; a
        // moving one ends that, and hovering takes over.
        const paused = pausedRef.current;
        if (paused) {
          if (paused.at && Math.hypot(move.clientX - paused.at.x, move.clientY - paused.at.y) <= TWITCH_PX) return;
          setPaused(null);
        }
        if (playRef.current !== null) {
          // A still hand keeps it playing; a moving one takes over.
          const start = originRef.current;
          if (start && Math.hypot(move.clientX - start.x, move.clientY - start.y) <= TWITCH_PX) return;
          handBack();
          return;
        }
        // Hovering. Only real movement points at a row: rows moving under a
        // still cursor (a raise, the reel, the list settling) fire mouse events
        // too, which is why rows have no hover handlers of their own.
        if (move.pointerType === "touch") return;
        const row = rowAt(move.clientX, move.clientY);
        if (row) follow({ ...row, x: move.clientX });
        else if (activeRef.current !== null) endHover();
      },
      { passive: true, signal: listening.signal }
    );
    // Leaving the window is leaving the list: it stops a slideshow, and the
    // preview goes blank, then a random image and the list settles, as after
    // any other leave.
    document.documentElement.addEventListener(
      "mouseleave",
      () => {
        setPaused(null);
        if (playRef.current !== null) stopPlaying();
        if (activeRef.current !== null) endHover();
      },
      { signal: listening.signal }
    );
    // A click anywhere stops it where it is, or carries on, even over no row.
    window.addEventListener(
      "click",
      (click) => {
        if (click === answeredClickRef.current) return;
        if (playRef.current !== null) stopHere();
        else if (pausedRef.current) resume();
      },
      { signal: listening.signal }
    );
    // Scrolling counts as moving: the rows move under the cursor, so it stops a
    // slideshow, ends a stop's carry-on, and the row now under it takes over.
    const scrolled = () => {
      const hand = handRef.current;
      if (!hand) return;
      setPaused(null);
      if (playRef.current !== null) {
        handBack();
        return;
      }
      const row = rowAt(hand.x, hand.y);
      if (row) follow({ ...row, x: hand.x });
      else if (activeRef.current !== null) endHover();
    };
    mainRef.current?.addEventListener(
      "scroll",
      () => {
        // The list's own moves scroll the page too; only the user's count.
        const main = mainRef.current;
        if (main && ownScrollRef.current !== null && Math.abs(main.scrollTop - ownScrollRef.current) < 1) return;
        ownScrollRef.current = null;
        holdList();
        // Scrolling back up melts away room a raised row needed; never below
        // what the current position needs, so nothing jumps.
        if (main) {
          setRoom(roomFor(main.scrollTop));
          userScrollRef.current = main.scrollTop;
        }
        scrolled();
      },
      { passive: true, signal: listening.signal }
    );
    // Scrolling up at the top, with a row brought down there: there's nothing
    // left to scroll, so the list itself goes back up, towards its place.
    mainRef.current?.addEventListener(
      "wheel",
      (wheel) => {
        const main = mainRef.current;
        const dy = wheel.deltaMode === 1 ? wheel.deltaY * 16 : wheel.deltaY;
        if (!main || dy >= 0 || main.scrollTop > 0 || shiftRef.current <= 0) return;
        holdList();
        drawShift(Math.max(0, shiftRef.current + dy));
        aimRef.current = { scroll: 0, shift: shiftRef.current };
        userScrollRef.current = 0;
        scrolled();
      },
      { passive: true, signal: listening.signal }
    );
    return () => listening.abort();
  }, []);

  const current = active === null ? null : projects[active];
  // Covers and their siblings are the same files the canvas already fetched as
  // textures, so the swap comes out of the browser cache rather than the network.
  const src = current ? current.images[Math.min(shown, current.images.length - 1)] : (ambient?.src ?? null);

  return (
    <main ref={mainRef} className={styles.page}>
      <div ref={innerRef} className={styles.inner}>
        {/* Idle only counts while a row is active: with none, there's no picture to
            clear. A slideshow playing counts at once, without the wait. */}
        <ul ref={listRef} className={`${styles.list} ${(idle || playing) && active !== null ? styles.idle : ""}`}>
          {projects.map((project, index) => (
            <li key={`${project.id}-${index}`}>
              <button
                ref={(el) => {
                  rowsRef.current[index] = el;
                }}
                type="button"
                className={`${styles.row} ${active === index ? styles.active : ""}`}
                aria-pressed={active === index && playing}
                // Quiet while playing, and while stopped where it is, until the hand moves.
                data-quiet={active === index && (playing || stoppedHere) ? "" : undefined}
                onClick={(e) => onClick(e, index)}
                // Keyboard focus lands on the project, not a position in it:
                // there is no cursor to read, so it starts at the first image.
                // A click focuses the row too, and handles itself.
                onFocus={(e) => {
                  if (!e.currentTarget.matches(":focus-visible") || activeRef.current === index) return;
                  stopPlaying();
                  activate(index, 0);
                  setSpot({ pos: 0, transition: "none" });
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

      <div ref={roomElRef} className={styles.room} aria-hidden="true" />

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
