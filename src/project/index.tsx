import * as React from "react";
import allManifest from "~/src/work/manifest.json";
import type { MediaItem } from "~/src/infinite-canvas/types";
import {
  beginHeroTween,
  consumePendingTransition,
  hideTransitionSource,
  holdTransition,
  releaseTransition,
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
const SETTLE_MS = 600;
/** Exit beat 2: the settled row travels left to centre the image you came from,
 *  while the images it passes drop away one by one. */
const SHIFT_MS = 600;
const EXIT_FADE_MS = 350;
/**
 * Wheel and trackpad browse like the arrow keys: down / right is next. One
 * gesture moves one image — a step needs WHEEL_STEP px of travel one way, then
 * the wheel locks so a trackpad's glide (or a wheel spun in one go) can't run
 * through the album. The lock lifts after WHEEL_QUIET_MS of silence, or as soon
 * as a new swipe starts inside the glide: a glide only ever slows down and never
 * turns round, so the wheel speeding back up (by WHEEL_RESWIPE_PX and double
 * its slowest) or reversing is fingers back on the trackpad. A step that
 * arrives mid-move is queued, not dropped.
 */
const WHEEL_STEP = 40;
const WHEEL_QUIET_MS = 180;
const WHEEL_RESWIPE_PX = 6;
/** Beat between the arrival settling and the first image scaling up. */
const FUSE_PAUSE_MS = 260;

/**
 * arrive — flat row, manifest rotated so the clicked image leads (part 1).
 * hero   — same order, one image at HERO_HEIGHT_FRAC, centred (part 2).
 * settle — same order, everything back to row height (exit beat 1).
 * centre — settled row slid left so the arrival image is centred (exit beat 2).
 * out    — same positions, supporting images dropping away (exit beat 3).
 */
type Phase = "arrive" | "hero" | "settle" | "centre" | "out";

interface Slot {
  x: number;
  scale: number;
}

export function ProjectPage({ id, onClose }: { id: string; onClose: () => void }) {
  // Capture once on mount — clears the module-level store
  const transitionRef = React.useRef(consumePendingTransition());

  // Rotate the project's images so the clicked one is always first (leftmost).
  // The row keeps this order throughout — no flip — so the clicked image is
  // the one that scales up, and "next" is always the image to its right.
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
  const [heroIdx, setHeroIdx] = React.useState(0);
  const [motion, setMotion] = React.useState({ ms: 0, ease: TURN_EASE });
  // Nothing is clickable while a move runs — the canvas half of this already
  // lives in transition-origin; this is the DOM half.
  const [busy, setBusy] = React.useState(true);

  const timersRef = React.useRef<number[]>([]);
  const after = (ms: number, fn: () => void) => {
    timersRef.current.push(window.setTimeout(fn, ms));
  };
  React.useEffect(
    () => () => {
      for (const t of timersRef.current) clearTimeout(t);
      timersRef.current = [];
    },
    [],
  );

  // One row, all images at equal height, scaled down until the row fits the screen
  const aspects = images.map((img) => img.width / img.height);
  const sumAspect = aspects.reduce((sum, a) => sum + a, 0);
  const availW = viewport.w - MARGIN * 2 - GAP * (images.length - 1);
  const rowH = Math.min(viewport.h * MAX_ROW_HEIGHT_FRAC, availW / Math.max(sumAspect, 0.0001));
  const heroH = viewport.h * HERO_HEIGHT_FRAC;

  // Visual order is the arrival order in every phase; the image you came from
  // stays in slot 0.
  const count = images.length;
  const seq = images.map((_, i) => i);
  const arrivalSlotIdx = 0;

  // Per-image x / scale. Every state is a permutation or a scale of the same
  // fit-to-width row, so the row width is invariant and nothing relayouts.
  const slots: Slot[] = new Array(count);
  {
    const scales = seq.map((_, k) => (phase === "hero" && k === heroIdx ? heroH / rowH : 1));
    const widths = seq.map((imgI, k) => aspects[imgI] * rowH * scales[k]);
    const xs: number[] = [];
    let cursor = 0;
    for (let k = 0; k < count; k++) {
      xs.push(cursor);
      cursor += widths[k] + GAP;
    }
    // Centre whichever image the moment is about. Settling keeps the image you
    // were looking at where it is, so it shrinks in place — anchoring the row to
    // the margin instead would throw it out to the right only to walk it back,
    // and would do nothing at all when you were already on the last one.
    const centred =
      phase === "hero" || phase === "settle"
        ? heroIdx
        : phase === "centre" || phase === "out"
          ? arrivalSlotIdx
          : -1;
    const shift =
      centred >= 0 ? viewport.w / 2 - (xs[centred] + widths[centred] / 2) : MARGIN;
    seq.forEach((imgI, k) => {
      slots[imgI] = { x: xs[k] + shift, scale: scales[k] };
    });
  }

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

      const satellites = Array.from(
        overlay.querySelectorAll<HTMLElement>(`.${styles.image}`),
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
      setHeroIdx(0);
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
    // The gesture that set the lock: its direction, its fastest delta, and —
    // once it has started to slow — its slowest since.
    dir: 0,
    peak: 0,
    trough: 0,
    decaying: false,
  });

  const advance = (to: number) => {
    setBusy(true);
    setMotion({ ms: ADV_MS, ease: TURN_EASE });
    setHeroIdx(to);
    after(ADV_MS, () => {
      const queued = wheelRef.current.queued;
      wheelRef.current.queued = 0;
      const next = to + queued;
      if (queued && next >= 0 && next < count) advance(next);
      else setBusy(false);
    });
  };

  /** Left half is previous, right half is next — the strip already runs that way. */
  const step = (dir: -1 | 1) => {
    if (busy || phase !== "hero") return;
    const to = heroIdx + dir;
    if (to < 0 || to >= count) return;
    advance(to);
  };

  /**
   * Exit, in three beats. Settling to row height keeps the current image
   * centred. The row then travels to bring the image you arrived on (slot 0)
   * to centre — a pure translation, nothing scaling — and only then does it
   * fly to its own plane while the rest drop 32px away, the exact reverse of
   * how they rose.
   */
  const runExit = () => {
    if (busy) return;
    setBusy(true);
    setMotion({ ms: SETTLE_MS, ease: TURN_EASE });
    setPhase("settle");

    after(SETTLE_MS, () => {
      setMotion({ ms: SHIFT_MS, ease: TURN_EASE });
      setPhase("centre");

      // The row travels as one object, but the images leave one at a time —
      // furthest from the departing image first, so by the time it flies most
      // of what was beside it has gone. Mirrors the entry stagger.
      const overlay = overlayRef.current;
      const hero = heroImgRef.current;
      if (!overlay) return;
      const imgs = Array.from(overlay.querySelectorAll<HTMLElement>(`.${styles.image}`));
      for (const el of imgs) {
        if (el === hero) continue;
        // DOM order is the visual order and the departing image is leftmost,
        // so the furthest is the last in the DOM: it gets no delay.
        const fromFar = count - 1 - imgs.indexOf(el);
        const delay = (fromFar * SAT_STAGGER_S).toFixed(2);
        el.style.transition = `opacity ${EXIT_FADE_MS}ms ease ${delay}s, transform 0.5s ${TURN_EASE} ${delay}s`;
        el.style.opacity = "0";
        el.style.transform = `translateY(${RISE_PX}px)`;
      }
    });

    after(SETTLE_MS + SHIFT_MS, () => {
      const t = transitionRef.current;
      const overlay = overlayRef.current;
      const hero = heroImgRef.current;
      if (!t?.sourceKey || !hero || !overlay) {
        fadeClose();
        return;
      }
      const r = hero.getBoundingClientRect();
      // Re-pin the plane to wherever the row has carried this image, then fly
      // it home. Setting the tween before un-hiding means the plane never
      // draws a frame at its old pin.
      beginHeroTween(
        t.sourceKey,
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
      setMotion({ ms: FLIGHT_MS, ease: TURN_EASE });
      setPhase("out");
      // If the plane never reports arrival, leave anyway.
      after(FLIGHT_MS + 400, () => {
        releaseTransition();
        onClose();
      });
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
      const quiet = e.timeStamp - w.last > WHEEL_QUIET_MS;
      w.last = e.timeStamp;

      let fresh = quiet;
      if (w.locked && !fresh && speed > 0) {
        if (Math.sign(px) !== w.dir) fresh = true;
        else if (!w.decaying) {
          w.peak = Math.max(w.peak, speed);
          if (speed < w.peak * 0.6) {
            w.decaying = true;
            w.trough = speed;
          }
        } else {
          w.trough = Math.min(w.trough, speed);
          fresh = speed >= w.trough * 2 && speed >= w.trough + WHEEL_RESWIPE_PX;
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
      w.peak = speed;
      w.decaying = false;
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
      <button type="button" className={styles.close} onClick={runExit}>
        ×
      </button>

      {browsing && (
        <div className={styles.zones}>
          <button
            type="button"
            className={styles.zone}
            aria-label="Previous image"
            disabled={heroIdx <= 0}
            onClick={() => step(-1)}
          />
          <button
            type="button"
            className={styles.zone}
            aria-label="Next image"
            disabled={heroIdx >= count - 1}
            onClick={() => step(1)}
          />
        </div>
      )}

      <div className={styles.row}>
        {images.map((img, i) => (
          <div
            key={img.url}
            className={styles.slot}
            style={{
              width: aspects[i] * rowH,
              height: rowH,
              marginTop: -rowH / 2,
              transform: `translate(${slots[i].x}px, 0) scale(${slots[i].scale})`,
              transition: motion.ms ? `transform ${motion.ms}ms ${motion.ease}` : "none",
              zIndex: phase === "hero" && seq[heroIdx] === i ? 2 : 1,
            }}
          >
            <img
              ref={i === 0 ? heroImgRef : null}
              src={`/${img.url}`}
              alt=""
              draggable={false}
              decoding="async"
              className={styles.image}
            />
          </div>
        ))}
      </div>
    </div>
  );
}
