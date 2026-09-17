import * as React from "react";
import allManifest from "~/src/work/manifest.json";
import type { MediaItem } from "~/src/infinite-canvas/types";
import {
  beginHeroTween,
  consumePendingTransition,
  getHeroScreenRect,
  hideTransitionSource,
  holdTransition,
  releaseTransition,
  swapTransitionSource,
} from "./transition-origin";
import styles from "./style.module.css";

const ALL_MEDIA = allManifest as MediaItem[];

const MARGIN = 32;
const GAP = 4;
/** Row height never exceeds this fraction of the viewport (small projects). */
const MAX_ROW_HEIGHT_FRAC = 0.5;
/** Part 3's enlarged image, as a fraction of viewport height. */
const HERO_HEIGHT_FRAC = 0.66;
const FLIGHT_MS = 1000;
const ENTRY_EASE = "cubic-bezier(0.22, 1, 0.36, 1)";
/** Supporting images rise this far into their slots after the hero lands. */
const RISE_PX = 32;
const SAT_STAGGER_S = 0.07;

/** The turn and every part-3 advance share one curve — measured, not chosen. */
const TURN_EASE = "cubic-bezier(0.42, 0, 0.58, 1)";
const TURN_MS = 600;
const ADV_MS = 500;
/** Exit: the rest of the row drops and fades, one after another, finishing
 *  inside the flight home however many images are on screen. */
const EXIT_FADE_MS = 350;
/** Longest the exit waits for the canvas plane to draw the closing image. */
const SWAP_TIMEOUT_MS = 1200;
/**
 * Wheel and trackpad browse like the arrow keys: down / right is next. One swipe
 * is one image, never more — a step needs WHEEL_STEP px of travel one way, then
 * the wheel locks for the rest of that swipe, trackpad glide included. Only a
 * second swipe unlocks it, and one made while the image is still moving queues
 * the next image.
 *
 * A second swipe is told apart from the glide conservatively. Nothing counts for
 * WHEEL_REFRACTORY_MS after the step (an uneven finger stroke lives there).
 * After that, speed is measured per frame, so events the browser merged while
 * the page was busy don't read as a speed-up, and averaged over the last three
 * events. The lock only lifts if that average climbs to WHEEL_RESWIPE_RATIO×
 * its slowest since, and WHEEL_RESWIPE_PX faster — a glide only slows —, or if
 * the direction reverses, or after WHEEL_QUIET_MS of silence.
 */
const WHEEL_STEP = 40;
const WHEEL_QUIET_MS = 180;
const WHEEL_REFRACTORY_MS = 200;
const WHEEL_RESWIPE_RATIO = 2.5;
const WHEEL_RESWIPE_PX = 10;
/** Beat between the arrival settling and the first image scaling up. */
const FUSE_PAUSE_MS = 260;

/**
 * arrive — flat row, manifest rotated so the clicked image leads (part 1).
 * hero    — one image at HERO_HEIGHT_FRAC, centred, the row looping (part 2).
 * leaving — same layout; the image you're on shrinks home as a canvas plane
 *           while the rest drop away.
 */
type Phase = "arrive" | "hero" | "leaving";

export function ProjectPage({ id, onClose }: { id: string; onClose: () => void }) {
  // Capture once on mount — clears the module-level store
  const transitionRef = React.useRef(consumePendingTransition());

  // Rotate the project's images so the clicked one is always first (leftmost).
  // The row keeps this order throughout — no flip — so the clicked image is
  // the one that scales up; after that the row is revealed to be endless.
  const filtered = ALL_MEDIA.filter((item) => item.project === id);
  const start = transitionRef.current?.startIndex ?? 0;
  const images = start > 0 ? [...filtered.slice(start), ...filtered.slice(0, start)] : filtered;

  const [viewport, setViewport] = React.useState({ w: window.innerWidth, h: window.innerHeight });
  React.useEffect(() => {
    const onResize = () => setViewport({ w: window.innerWidth, h: window.innerHeight });
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  const [phase, setPhase] = React.useState<Phase>("arrive");
  // Virtual position of the enlarged image. Unbounded: the row loops.
  const [heroPos, setHeroPos] = React.useState(0);
  const [motion, setMotion] = React.useState({ ms: 0, ease: TURN_EASE });
  // Nothing is clickable while a move runs — the canvas half of this already
  // lives in transition-origin; this is the DOM half.
  const [busy, setBusy] = React.useState(true);

  const timersRef = React.useRef<number[]>([]);
  const after = (ms: number, fn: () => void) => {
    timersRef.current.push(window.setTimeout(fn, ms));
  };
  const rafRef = React.useRef(0);
  React.useEffect(
    () => () => {
      for (const t of timersRef.current) clearTimeout(t);
      timersRef.current = [];
      cancelAnimationFrame(rafRef.current);
    },
    [],
  );

  // One row, all images at equal height, scaled down until the row fits the screen
  const aspects = images.map((img) => img.width / img.height);
  const sumAspect = aspects.reduce((sum, a) => sum + a, 0);
  const availW = viewport.w - MARGIN * 2 - GAP * (images.length - 1);
  const rowH = Math.min(viewport.h * MAX_ROW_HEIGHT_FRAC, availW / Math.max(sumAspect, 0.0001));
  const heroH = viewport.h * HERO_HEIGHT_FRAC;

  // The row is endless: virtual position k shows images[mod(k)], so positions
  // below 0 are the images before the one you clicked and positions past the
  // end come round again. Arrival lays out 0..count-1 from the margin exactly as
  // a finite row; the copies either side are already in place, only hidden, and
  // slide in with the row when the first image scales up.
  const count = images.length;
  const mod = (k: number) => ((k % count) + count) % count;
  const centred = phase === "arrive" ? null : heroPos;
  const scaleOf = (k: number) => (centred !== null && k === heroPos ? heroH / rowH : 1);
  const baseW = (k: number) => aspects[mod(k)] * rowH;

  // Render a screen and a quarter past each side of every position the row can
  // be anchored on, so images only ever enter or leave the DOM off-screen.
  const reach = viewport.w * 1.25;
  const edge = (from: number, dir: -1 | 1) => {
    let k = from;
    for (let covered = 0, n = 0; covered < reach && n < count * 8 + 16; n++) {
      k += dir;
      covered += baseW(k) + GAP;
    }
    return k;
  };
  const anchors = [centred ?? 0];
  const kMin = Math.min(...anchors.map((a) => edge(a, -1)));
  const kMax = Math.max(...anchors.map((a) => edge(a, 1)));
  const positions = Array.from({ length: kMax - kMin + 1 }, (_, i) => kMin + i);

  // Per-position x. After the scale-up the image you're on is centred; before
  // it nothing is, and position 0 sits on the margin.
  const anchorK = centred ?? 0;
  const xs = new Map<number, number>();
  xs.set(anchorK, centred === null ? MARGIN : viewport.w / 2 - (baseW(anchorK) * scaleOf(anchorK)) / 2);
  for (let k = anchorK + 1; k <= kMax; k++) {
    xs.set(k, (xs.get(k - 1) ?? 0) + baseW(k - 1) * scaleOf(k - 1) + GAP);
  }
  for (let k = anchorK - 1; k >= kMin; k--) {
    xs.set(k, (xs.get(k + 1) ?? 0) - GAP - baseW(k) * scaleOf(k));
  }

  // The counter reads the project's own order, not the rotated one.
  const digits = Math.max(2, String(count).length);
  const counter = `${String(((start + mod(heroPos)) % count) + 1).padStart(digits, "0")} / ${String(count).padStart(digits, "0")}`;

  const overlayRef = React.useRef<HTMLDivElement>(null);
  const heroImgRef = React.useRef<HTMLImageElement>(null);

  // Entry: the WebGL plane itself flies to the hero slot (measured below) while
  // the other slots stagger-fade in. The DOM hero image is revealed only after
  // the plane is pinned at rest exactly on the slot — an invisible handoff.
  React.useLayoutEffect(() => {
    const overlay = overlayRef.current;
    const t = transitionRef.current;
    const hero = heroImgRef.current;

    if (!overlay) return;

    if (t?.sourceKey && hero) {
      const sourceKey = t.sourceKey;
      let canceled = false;
      // StrictMode runs this effect twice with a releaseTransition in between —
      // re-assert the hold, and only ever restore styles to "" (the class value)
      // so the second run can't capture the first run's frozen "0".
      holdTransition();
      overlay.style.background = "transparent";
      hero.style.opacity = "0";

      // Only the arrival row enters; the copies either side stay hidden until the reveal.
      const satellites = Array.from(
        overlay.querySelectorAll<HTMLElement>("[data-arrival]"),
      ).filter((el) => el !== hero);
      const closeBtn = overlay.querySelector<HTMLElement>(`.${styles.close}`);
      for (const el of satellites) {
        el.style.transition = "none";
        el.style.opacity = "0";
        el.style.transform = `translateY(${RISE_PX}px)`;
      }
      if (closeBtn) {
        closeBtn.style.transition = "none";
        closeBtn.style.opacity = "0";
      }

      // Warm every row image's decoder now, so the bitmaps are ready on
      // background threads long before anything needs to paint them —
      // decode spikes during the flight read as stutter.
      for (const el of overlay.querySelectorAll("img")) {
        (el as HTMLImageElement).decode().catch(() => {});
      }

      // Only after the hero has landed do the supporting images enter: each
      // rises from below into its slot, staggered left to right.
      const enterSatellites = () => {
        satellites.forEach((el, j) => {
          const delay = (j * SAT_STAGGER_S).toFixed(2);
          el.style.transition = `opacity 0.45s ease ${delay}s, transform 0.7s ${ENTRY_EASE} ${delay}s`;
          el.style.opacity = "";
          el.style.transform = "";
        });
        if (closeBtn) {
          closeBtn.style.transition = "opacity 0.4s ease 0.3s";
          closeBtn.style.opacity = "";
        }
      };

      const reveal = () => {
        requestAnimationFrame(() => {
          if (canceled) return;
          hero.style.transition = "none";
          hero.style.opacity = "";
          // Two frames of overlap before dropping the plane: the DOM image must
          // have actually painted (DOM compositing and the WebGL loop aren't
          // perfectly in phase), or the handoff flashes white.
          requestAnimationFrame(() => {
            requestAnimationFrame(() => {
              if (canceled) return;
              hideTransitionSource(sourceKey);
              overlay.style.background = "";
              hero.style.transition = "";
              enterSatellites();
            });
          });
        });
      };

      const heroRect = hero.getBoundingClientRect();
      beginHeroTween(
        sourceKey,
        { x: heroRect.x, y: heroRect.y, width: heroRect.width, height: heroRect.height },
        FLIGHT_MS,
        () => {
          // Always decode() — `complete` means the bytes arrived, not that the
          // bitmap is rasterizable; revealing an undecoded image paints nothing
          // for a few frames (the white flicker). Resolves instantly if warm.
          hero.decode().then(reveal, reveal);
        },
      );

      // If the plane never arrives (edge: it unmounted), force the end state.
      const failSafe = setTimeout(() => {
        hero.style.transition = "";
        hero.style.opacity = "";
        hideTransitionSource(sourceKey);
        overlay.style.background = "";
        enterSatellites();
      }, FLIGHT_MS + 800);

      const cleanup = setTimeout(
        () => {
          for (const el of satellites) el.style.transition = "";
          if (closeBtn) closeBtn.style.transition = "";
        },
        FLIGHT_MS + 1000 * (satellites.length * SAT_STAGGER_S + 0.7) + 500,
      );

      return () => {
        canceled = true;
        clearTimeout(failSafe);
        clearTimeout(cleanup);
        // Undo every inline style this run set, so a re-run starts clean
        overlay.style.background = "";
        hero.style.transition = "";
        hero.style.opacity = "";
        for (const el of satellites) {
          el.style.transition = "";
          el.style.opacity = "";
          el.style.transform = "";
        }
        if (closeBtn) {
          closeBtn.style.transition = "";
          closeBtn.style.opacity = "";
        }
      };
    }

    // Fallback: simple fade in when no transition data (e.g. direct URL load)
    overlay.style.opacity = "0";
    const raf = requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        overlay.style.transition = "opacity 0.3s";
        overlay.style.opacity = "1";
      });
    });
    const cleanup = setTimeout(() => {
      overlay.style.transition = "";
      overlay.style.opacity = "";
    }, 420);
    return () => {
      cancelAnimationFrame(raf);
      clearTimeout(cleanup);
    };
  }, []);

  // Part 2, once the arrival has settled: the first image — the one you clicked —
  // scales up to hero height and moves to centre, the row sliding along with it.
  React.useEffect(() => {
    const flew = Boolean(transitionRef.current?.sourceKey);
    const settleAt = flew
      ? FLIGHT_MS + (images.length - 1) * SAT_STAGGER_S * 1000 + 700 + FUSE_PAUSE_MS
      : 500;
    const timer = window.setTimeout(() => {
      setMotion({ ms: TURN_MS, ease: TURN_EASE });
      setHeroPos(0);
      setPhase("hero");
      after(TURN_MS, () => setBusy(false));
    }, settleAt);
    return () => clearTimeout(timer);
  }, []);

  // Whatever the exit path, give the canvas back
  React.useEffect(() => releaseTransition, []);

  const fadeClose = () => {
    releaseTransition();
    const overlay = overlayRef.current;
    if (overlay) {
      overlay.style.transition = "opacity 0.3s ease";
      overlay.style.opacity = "0";
      after(320, onClose);
    } else {
      onClose();
    }
  };

  const wheelRef = React.useRef({
    last: 0,
    accum: 0,
    locked: false,
    queued: 0 as -1 | 0 | 1,
    // The swipe that set the lock: its direction, when it stepped, and its
    // slowest averaged speed since the refractory window closed.
    dir: 0,
    lockedAt: 0,
    slowest: Number.POSITIVE_INFINITY,
    recent: [] as number[],
  });

  const advance = (to: number) => {
    setBusy(true);
    setMotion({ ms: ADV_MS, ease: TURN_EASE });
    setHeroPos(to);
    after(ADV_MS, () => {
      const queued = wheelRef.current.queued;
      wheelRef.current.queued = 0;
      if (queued) advance(to + queued);
      else setBusy(false);
    });
  };

  /** Left half is previous, right half is next. The row loops, so neither ends. */
  const step = (dir: -1 | 1) => {
    if (busy || phase !== "hero") return;
    advance(heroPos + dir);
  };

  // Warm the canvas-size copy of whichever image you're on, so if you close on
  // it the plane has it straight away.
  const currentCanvasUrl = images[mod(heroPos)]?.canvasUrl;
  React.useEffect(() => {
    if (currentCanvasUrl) new Image().src = `/${currentCanvasUrl}`;
  }, [currentCanvasUrl]);

  /**
   * Exit, from whichever image you're on. The plane you opened the project from
   * takes that image: once it's drawing it, the plane re-pins over the enlarged
   * image and flies home, shrinking to its canvas size while the camera centres
   * it. Meanwhile the rest of the row drops and fades, furthest first, closing
   * in on it. The canvas keeps the new image there.
   */
  const runExit = () => {
    if (busy) return;
    const t = transitionRef.current;
    const overlay = overlayRef.current;
    const hero = overlay?.querySelector<HTMLImageElement>(`[data-pos="${heroPos}"]`);
    const item = images[mod(heroPos)];
    if (!t?.sourceKey || !hero || !overlay || !item) {
      fadeClose();
      return;
    }
    const sourceKey = t.sourceKey;
    setBusy(true);
    // The row is moved by hand from here on, frame by frame, so no CSS transition.
    setMotion({ ms: 0, ease: TURN_EASE });
    setPhase("leaving");

    // As the plane shrinks home, the rest of the row closes in to stay GAP from
    // its edges (and level with its centre), instead of holding the places it
    // had around the enlarged image.
    const slotOf = (el: HTMLElement) => el.parentElement as HTMLElement;
    const after0 = new Map<number, number>();
    const before0 = new Map<number, number>();
    for (let k = heroPos + 1, acc = 0; k <= kMax; k++) {
      after0.set(k, acc);
      acc += baseW(k) + GAP;
    }
    for (let k = heroPos - 1, acc = 0; k >= kMin; k--) {
      acc += baseW(k);
      before0.set(k, acc);
      acc += GAP;
    }
    const neighbours = Array.from(overlay.querySelectorAll<HTMLElement>("img[data-pos]")).filter((el) => el !== hero);
    const hug = () => {
      const r = getHeroScreenRect();
      if (r) {
        const dy = r.y + r.height / 2 - viewport.h / 2;
        for (const el of neighbours) {
          const k = Number(el.dataset.pos);
          const x = k > heroPos ? r.x + r.width + GAP + (after0.get(k) ?? 0) : r.x - GAP - (before0.get(k) ?? 0);
          slotOf(el).style.transform = `translate(${x}px, ${dy}px)`;
        }
      }
      rafRef.current = requestAnimationFrame(hug);
    };
    rafRef.current = requestAnimationFrame(hug);

    const imgs = Array.from(overlay.querySelectorAll<HTMLElement>(`.${styles.image}`)).filter((el) => el !== hero);
    const onScreen = imgs.filter((el) => {
      const r = el.getBoundingClientRect();
      return r.right > 0 && r.left < window.innerWidth;
    });
    const ring = (el: HTMLElement) => Math.abs(Number(el.dataset.pos) - heroPos);
    const rings = Math.max(1, ...onScreen.map(ring));
    const stagger = Math.min(SAT_STAGGER_S, (FLIGHT_MS - EXIT_FADE_MS) / 1000 / rings);
    for (const el of imgs) {
      // Furthest first, so the row empties in toward the image going home.
      const delay = onScreen.includes(el) ? ((rings - ring(el)) * stagger).toFixed(3) : "0";
      el.style.transition = `opacity ${EXIT_FADE_MS}ms ease ${delay}s, transform 0.5s ${TURN_EASE} ${delay}s`;
      el.style.opacity = "0";
      el.style.transform = `translateY(${RISE_PX}px)`;
    }

    let flown = false;
    const flyHome = () => {
      if (flown) return;
      flown = true;
      const r = hero.getBoundingClientRect();
      // Setting the tween before un-hiding means the plane never draws a frame
      // at its old pin.
      beginHeroTween(
        sourceKey,
        { x: r.x, y: r.y, width: r.width, height: r.height },
        FLIGHT_MS,
        () => {
          releaseTransition();
          onClose();
        },
        "out",
      );
      hideTransitionSource(null);
      hero.style.opacity = "0";
      overlay.style.background = "transparent";
      // If the plane never reports arrival, leave anyway.
      after(FLIGHT_MS + 400, () => {
        releaseTransition();
        onClose();
      });
    };
    swapTransitionSource(sourceKey, item, flyHome);
    // A texture that never arrives shouldn't strand the page.
    after(SWAP_TIMEOUT_MS, () => {
      if (!flown) fadeClose();
    });
  };

  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // Escape is a bail-out, so it stays live even mid-move — the choreographed
      // exit needs a settled row to work from, so interrupt with a plain fade.
      if (e.key === "Escape") (busy ? fadeClose : runExit)();
      if (e.key === "ArrowRight") step(1);
      if (e.key === "ArrowLeft") step(-1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  React.useEffect(() => {
    const onWheel = (e: WheelEvent) => {
      // Nothing behind the page should scroll, and a sideways trackpad swipe
      // must not turn into the browser's back gesture.
      e.preventDefault();
      const w = wheelRef.current;
      const raw = Math.abs(e.deltaY) >= Math.abs(e.deltaX) ? e.deltaY : e.deltaX;
      const px = e.deltaMode === 1 ? raw * 16 : e.deltaMode === 2 ? raw * window.innerHeight : raw;
      const speed = Math.abs(px);
      const gap = e.timeStamp - w.last;
      const quiet = gap > WHEEL_QUIET_MS;
      w.last = e.timeStamp;
      // Pixels per frame: a merged event covers several frames' worth of travel.
      const perFrame = (speed * 16) / Math.min(Math.max(gap, 16), 100);
      w.recent = [...w.recent.slice(-2), perFrame];
      const avg = w.recent.reduce((a, b) => a + b, 0) / w.recent.length;

      let fresh = quiet;
      if (w.locked && !fresh && speed > 0 && e.timeStamp - w.lockedAt > WHEEL_REFRACTORY_MS) {
        if (Math.sign(px) !== w.dir && speed >= 4) fresh = true;
        else {
          w.slowest = Math.min(w.slowest, avg);
          fresh = avg >= w.slowest * WHEEL_RESWIPE_RATIO && avg >= w.slowest + WHEEL_RESWIPE_PX;
        }
      }
      if (fresh) {
        w.locked = false;
        w.accum = 0;
      }
      if (w.locked) return;

      if (Math.sign(px) !== Math.sign(w.accum)) w.accum = 0;
      w.accum += px;
      if (Math.abs(w.accum) < WHEEL_STEP) return;

      const dir = w.accum > 0 ? 1 : -1;
      w.accum = 0;
      w.locked = true;
      w.dir = dir;
      w.lockedAt = e.timeStamp;
      w.slowest = Number.POSITIVE_INFINITY;
      if (phase !== "hero") return;
      if (busy) w.queued = dir;
      else step(dir);
    };
    window.addEventListener("wheel", onWheel, { passive: false });
    return () => window.removeEventListener("wheel", onWheel);
  });

  if (!images.length) return null;

  const browsing = phase === "hero" && !busy;

  return (
    <div className={styles.overlay} ref={overlayRef}>
      <button
        type="button"
        className={styles.close}
        onClick={runExit}
        style={phase === "leaving" ? { opacity: 0, transition: "opacity 0.3s ease" } : undefined}
      >
        ×
      </button>

      {browsing && (
        <div className={styles.zones}>
          <button type="button" className={styles.zone} aria-label="Previous image" onClick={() => step(-1)} />
          <button type="button" className={styles.zone} aria-label="Next image" onClick={() => step(1)} />
        </div>
      )}

      <div className={`${styles.counter} ${phase === "hero" ? styles.counterShown : ""}`}>{counter}</div>

      <div className={styles.row}>
        {positions.map((k) => {
          const img = images[mod(k)];
          const inArrivalRow = k >= 0 && k < count;
          return (
            <div
              key={k}
              className={styles.slot}
              style={{
                width: baseW(k),
                height: rowH,
                marginTop: -rowH / 2,
                transform: `translate(${xs.get(k) ?? 0}px, 0) scale(${scaleOf(k)})`,
                transition: motion.ms ? `transform ${motion.ms}ms ${motion.ease}` : "none",
                zIndex: centred !== null && k === heroPos ? 2 : 1,
              }}
            >
              <img
                ref={k === 0 ? heroImgRef : null}
                data-pos={k}
                data-arrival={inArrivalRow ? "" : undefined}
                src={`/${img.url}`}
                alt=""
                draggable={false}
                decoding="async"
                className={styles.image}
                // The copies are in place from the start, hidden, and appear the
                // moment the row starts to move — so they slide in with it.
                style={phase === "arrive" && !inArrivalRow ? { opacity: 0 } : undefined}
              />
            </div>
          );
        })}
      </div>
    </div>
  );
}
