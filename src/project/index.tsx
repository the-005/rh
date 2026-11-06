import * as React from "react";
import type { MediaItem } from "~/src/infinite-canvas/types";
import {
  beginHeroTween,
  consumePendingTransition,
  hideTransitionSource,
  holdTransition,
  releaseTransition,
  returnCanvas,
  setCanvasPaused,
  swapTransitionSource,
} from "./transition-origin";
import styles from "./style.module.css";
import { useStripVideos } from "./videos";
import { getSettings } from "~/src/settings/store";
import { MEDIA } from "~/src/work/data";

// What the site shows, loaded before the app (src/work/data).
const ALL_MEDIA: MediaItem[] = MEDIA;

const MARGIN = 32;
const GAP = 4;
/** The arrival row is never thicker than this fraction of the window across
 *  it (its height; a column's width) (small projects). */
const MAX_ROW_HEIGHT_FRAC = 0.5;
/** After arrival the whole row scales up to fill this fraction of the window
 *  across it (its height; a column's width) and becomes a strip you scroll through. */
const STRIP_HEIGHT_FRAC = 1;
const FLIGHT_MS = 1000;
const ENTRY_EASE = "cubic-bezier(0.22, 1, 0.36, 1)";
/** Supporting images rise this far into their slots after the hero lands. */
const RISE_PX = 32;
const RISE_MS = 700;
/** When each of the m rising images starts, in ms after the plane lands: the
 *  wave's gap and cap (RISE_GAP_MS, RISE_WAVE_MAX_MS) live in `src/settings`,
 *  where the settings panel can change them, and are read as each page opens. */
const riseDelays = (m: number) => {
  const { riseGapMs, riseWaveMaxMs } = getSettings();
  const gap = m > 1 && (m - 1) * riseGapMs > riseWaveMaxMs ? riseWaveMaxMs / (m - 1) : riseGapMs;
  return Array.from({ length: m }, (_, j) => j * gap);
};

/** The zoom into the strip keeps the curve every row move has used. */
const ZOOM_MS = 600;
/** Longest the exit waits for the canvas plane to draw the closing image. */
const SWAP_TIMEOUT_MS = 1200;
/** How far into the flight home the rest of the canvas starts fading back in.
 *  It used to wait for the landing, leaving the image alone on white for most
 *  of the flight (it has shrunk by ~150ms). */
const CANVAS_RETURN_MS = 300;
/**
 * Scrolling is free and continuous. Wheel and trackpad (either axis), drags and
 * arrow keys move a target, and the strip eases toward it every frame: a mouse
 * wheel's steps become a glide, a trackpad keeps its own momentum.
 */
const SCROLL_EASE = 0.1; // share of the remaining distance covered per 60fps frame
/** A drag let go while moving carries on for about this long at that speed. */
const FLING_MS = 250;
/** A drag held still this long before letting go doesn't fling. */
const FLING_STALE_MS = 80;
/** Within this of either end, the strip counts as at that end. */
const END_SLOP_PX = 1;
/** Arrow keys move the strip by this share of the window along it. */
const KEY_STEP_FRAC = 0.5;
/** Beat between the arrival settling and the zoom. */
const FUSE_PAUSE_MS = 260;
/** Images that get taller than this share of the strip during the zoom are
 *  decoded before it (6–8 per project; the rest decode small, as shown). */
const PREDECODE_ABOVE = 0.25;
/** Longest side of the copy the page starts each image on (`midUrl`,
 *  scripts/prepare-work.ts). It was the 1000px canvas copy until 2 Nov. */
const START_COPY_PX = 1500;
/** Full-size upgrades after the zoom run this many at a time, in strip order. */
const UPGRADE_CONCURRENCY = 2;
/** Longest the zoom waits for those decodes. */
const DECODE_WAIT_MS = 1000;
/** On a direct link the page stays blank until the row's images have loaded,
 *  but no longer than this; any still missing appear as they arrive. */
const ROW_LOAD_MAX_MS = 8000;

/**
 * arrive  — flat row, manifest rotated so the clicked image leads (part 1).
 * strip   — the whole row scaled up to STRIP_HEIGHT_FRAC, the clicked image at
 *           the left edge, scrolled sideways (part 2).
 * In a window taller than it's wide, all of it turns on its side: a column,
 * the clicked image at the top, scrolled down.
 * leaving — the image you're on flies home as a canvas plane, and the strip
 *           shrinks with it.
 */
type Phase = "arrive" | "strip" | "leaving";

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** CSS's cubic-bezier() as a function of progress, for motion run from script. */
const cubicBezier = (x1: number, y1: number, x2: number, y2: number) => {
  const at = (t: number, p1: number, p2: number) => ((1 - 3 * p2 + 3 * p1) * t * t + (3 * p2 - 6 * p1) * t + 3 * p1) * t;
  const slope = (t: number, p1: number, p2: number) => 3 * (1 - 3 * p2 + 3 * p1) * t * t + 2 * (3 * p2 - 6 * p1) * t + 3 * p1;
  return (x: number) => {
    if (x <= 0) return 0;
    if (x >= 1) return 1;
    let t = x;
    for (let i = 0; i < 8; i++) {
      const d = at(t, x1, x2) - x;
      if (Math.abs(d) < 1e-6) break;
      t -= d / slope(t, x1, x2);
    }
    return at(t, y1, y2);
  };
};
/** cubic-bezier(0.42, 0, 0.58, 1), the curve every row move has used. */
const zoomEase = cubicBezier(0.42, 0, 0.58, 1);

export function ProjectPage({ id, onClose }: { id: string; onClose: () => void }) {
  // Capture once on mount — clears the module-level store
  const transitionRef = React.useRef(consumePendingTransition());
  // Opened from the canvas, a plane flies in; opened by its link, nothing does.
  const flew = Boolean(transitionRef.current?.sourceKey);

  // Rotate the project's images so the clicked one is always first (leftmost).
  // The strip keeps this order and doesn't loop.
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
  // True once the zoom has run. Until then the slots sit in the arrival row as
  // far as React is concerned; the zoom moves them from script.
  const [settled, setSettled] = React.useState(false);
  // Nothing is clickable while a move runs — the canvas half of this already
  // lives in transition-origin; this is the DOM half.
  const [busy, setBusy] = React.useState(true);
  // The image you're on: it drives the counter and is the one that goes home.
  const [current, setCurrent] = React.useState(0);
  const [dragging, setDragging] = React.useState(false);
  // Images that started as their canvas copy and have since been swapped for
  // the full-size file.
  const [upgraded, setUpgraded] = React.useState<ReadonlySet<number>>(() => new Set());
  // The arrival is under way, which the zoom counts from: at once from the
  // canvas, and on a direct link once the row's images have loaded.
  const [arriving, setArriving] = React.useState(flew);

  const timersRef = React.useRef<number[]>([]);
  const after = (ms: number, fn: () => void) => {
    timersRef.current.push(window.setTimeout(fn, ms));
  };
  const rafRef = React.useRef(0);
  const scrollRef = React.useRef({ pos: 0, target: 0, raf: 0, last: 0 });
  const dragRef = React.useRef<{ id: number; x: number; from: number; lastX: number; lastT: number; v: number } | null>(null);
  React.useEffect(
    () => () => {
      for (const t of timersRef.current) clearTimeout(t);
      timersRef.current = [];
      cancelAnimationFrame(rafRef.current);
      cancelAnimationFrame(scrollRef.current.raf);
    },
    []
  );

  // A window taller than it's wide gets the strip on its side (the owner,
  // 7 Nov, for phones): a column that arrives centred, zooms to the window's
  // full width with the clicked image at the top, and scrolls down. Everything
  // below is worked out along the strip (x in a row, y in a column) and across
  // it, so the row and the column are the same strip.
  const vertical = viewport.h > viewport.w;
  const mainLen = vertical ? viewport.h : viewport.w;
  const crossLen = vertical ? viewport.w : viewport.h;

  // One row (or column), all images equally thick, scaled down until it fits the window
  const count = images.length;
  // Each image's length along the strip for each unit of its thickness.
  const along = images.map((img) => (vertical ? img.height / img.width : img.width / img.height));
  const sumAlong = along.reduce((sum, a) => sum + a, 0);
  const availMain = mainLen - MARGIN * 2 - GAP * (count - 1);
  const rowSize = Math.min(crossLen * MAX_ROW_HEIGHT_FRAC, availMain / Math.max(sumAlong, 0.0001));
  const stripSize = crossLen * STRIP_HEIGHT_FRAC;

  // The strip is laid out at its final size from the start, as on
  // wakawaka.world's intro: at arrival each image is shrunk into the row by its
  // own transform, and the zoom only takes that away. Nothing is blown up from a
  // small layout (which the browser draws soft, then redraws as it grows, and
  // re-lays out at the end, the flicker and snap the owner saw). The gaps stay
  // GAP throughout, since each image moves and scales on its own.
  const inStrip = phase !== "arrive";
  const shrink = rowSize / stripSize;
  const lengths = along.map((a) => a * stripSize);
  // Where each image starts along the strip (starts) and in the arrival row (rowStarts).
  const starts: number[] = [];
  const rowStarts: number[] = [];
  for (let k = 0, at = 0, rowAt = MARGIN; k < count; k++) {
    starts.push(at);
    rowStarts.push(rowAt);
    at += lengths[k] + GAP;
    rowAt += along[k] * rowSize + GAP;
  }
  const stripLen = count ? starts[count - 1] + lengths[count - 1] : 0;
  // The strip ends when its last image reaches the far edge.
  const maxScroll = inStrip ? Math.max(0, stripLen - mainLen) : 0;
  // A position along the strip as a transform.
  const along2d = (at: number) => (vertical ? `translate(0, ${at}px)` : `translate(${at}px, 0)`);

  // How big each image gets on screen during the zoom, as a share of the
  // strip's thickness: full size if it ends on screen, otherwise its size as it
  // leaves the window.
  const peaks = starts.map((at, k) => {
    const e = at < mainLen ? 1 : Math.min(1, (mainLen - rowStarts[k]) / (at - rowStarts[k]));
    return shrink + (1 - shrink) * e;
  });
  // Left to the zoom, the browser decodes the big ones mid-zoom, larger each
  // time as they grow (33 decodes on PR-01), which on a first visit cost frames;
  // a second visit was smooth because they were cached. So the ones that get
  // big are decoded before the zoom instead.
  const growsLarge = peaks.map((p) => p > PREDECODE_ABOVE);
  // Only the images that get bigger across the strip in the zoom than their
  // 1500px copy can show sharply (on this screen, at this pixel density) start
  // at full size: 2–4 per project on a laptop. The rest start as the copy and
  // are upgraded after the zoom, and only if the strip shows them bigger than
  // the copy at rest. Opening PR-01 went from about 31MB of downloads to about
  // 5MB. A phone held upright shows each image about 1170 pixels across, which
  // the copy covers: it never loads the 3000px files (45MB each once decoded),
  // which the full-height strip made it load and redraw through the zoom.
  const dpr = window.devicePixelRatio || 1;
  const copyAcross = images.map(
    (img) => (vertical ? img.width : img.height) * Math.min(1, START_COPY_PX / Math.max(img.width, img.height))
  );
  const startsFull = images.map((_, k) => peaks[k] * stripSize * dpr > copyAcross[k]);
  const needsFull = images.map((_, k) => stripSize * dpr > copyAcross[k]);

  // The image you clicked is 01, the strip's own order.
  const digits = Math.max(2, String(count).length);
  const counter = `${String(current + 1).padStart(digits, "0")} / ${String(count).padStart(digits, "0")}`;

  const overlayRef = React.useRef<HTMLDivElement>(null);
  const heroImgRef = React.useRef<HTMLImageElement>(null);
  const rowRef = React.useRef<HTMLDivElement>(null);

  // ---- scrolling ------------------------------------------------------------

  // The scroll loop runs outside React, so it reads the layout from here.
  const layoutRef = React.useRef({ starts, lengths, maxScroll, mainLen, vertical });
  const currentRef = React.useRef(0);
  React.useLayoutEffect(() => {
    layoutRef.current = { starts, lengths, maxScroll, mainLen, vertical };
  });

  /** The image taking up most of the screen; when two are about even, the one
   *  over the centre. At either end of the strip, its end image, whatever else
   *  is showing: close before scrolling and you leave with the image you
   *  clicked; scroll all the way and you leave with the last. */
  const imageAt = (pos: number) => {
    const L = layoutRef.current;
    if (pos <= END_SLOP_PX) return 0;
    if (L.maxScroll > 0 && pos >= L.maxScroll - END_SLOP_PX) return L.starts.length - 1;
    const centre = pos + L.mainLen / 2;
    let best = 0;
    let bestW = -1;
    for (let k = 0; k < L.starts.length; k++) {
      const shown = Math.min(L.starts[k] + L.lengths[k], pos + L.mainLen) - Math.max(L.starts[k], pos);
      const overCentre = L.starts[k] <= centre && centre <= L.starts[k] + L.lengths[k];
      if (shown > bestW + 1 || (shown > bestW - 1 && overCentre)) {
        best = k;
        bestW = shown;
      }
    }
    return best;
  };

  const applyScroll = (pos: number, arrived = false) => {
    scrollRef.current.pos = pos;
    if (rowRef.current)
      rowRef.current.style.transform = layoutRef.current.vertical
        ? `translate3d(0, ${-pos}px, 0)`
        : `translate3d(${-pos}px, 0, 0)`;
    const k = imageAt(pos);
    if (k !== currentRef.current) {
      currentRef.current = k;
      setCurrent(k);
    }
    videos.scrolled(pos, arrived);
  };

  const tick = (now: number) => {
    const s = scrollRef.current;
    const dt = s.last ? Math.min(now - s.last, 100) : 1000 / 60;
    s.last = now;
    const d = s.target - s.pos;
    if (Math.abs(d) < 0.5) {
      applyScroll(s.target, true);
      s.raf = 0;
      s.last = 0;
      return;
    }
    applyScroll(s.pos + d * (1 - (1 - SCROLL_EASE) ** (dt / (1000 / 60))));
    s.raf = requestAnimationFrame(tick);
  };

  const scrollTo = (target: number) => {
    const s = scrollRef.current;
    s.target = clamp(target, 0, layoutRef.current.maxScroll);
    if (!s.raf) s.raf = requestAnimationFrame(tick);
  };

  const stopScroll = () => {
    const s = scrollRef.current;
    cancelAnimationFrame(s.raf);
    s.raf = 0;
    s.last = 0;
    s.target = s.pos;
  };

  // Videos in the strip (./videos): a click centres one, scrolling plays the
  // one in view.
  const videos = useStripVideos({
    items: images,
    current,
    active: phase === "strip" && !busy,
    centre: (k) => {
      const L = layoutRef.current;
      const target = clamp(L.starts[k] + L.lengths[k] / 2 - L.mainLen / 2, 0, L.maxScroll);
      scrollTo(target);
      return target;
    },
  });
  // Where a press began, to tell a click on a video from a drag.
  const pressRef = React.useRef<{ k: number; x: number; y: number } | null>(null);

  // A resize can shorten the strip; keep the scroll inside it. Turning the
  // screen mid-strip lays it out the other way round: it carries on from the
  // image you were on, centred in the window, so it stays the current one
  // (at the start of a wide window the next image would count as current).
  const wasVertical = React.useRef(vertical);
  React.useEffect(() => {
    const turned = wasVertical.current !== vertical;
    wasVertical.current = vertical;
    if (phase !== "strip") return;
    const s = scrollRef.current;
    if (turned) {
      stopScroll();
      const k = currentRef.current;
      const at = clamp((starts[k] ?? 0) + (lengths[k] ?? 0) / 2 - mainLen / 2, 0, maxScroll);
      s.target = at;
      applyScroll(at);
      return;
    }
    s.target = Math.min(s.target, maxScroll);
    applyScroll(Math.min(s.pos, maxScroll));
  }, [maxScroll, phase, vertical]);

  // Entry: the WebGL plane itself flies to the hero slot (measured below) while
  // the other slots stagger-fade in. The DOM hero image is revealed only after
  // the plane is pinned at rest exactly on the slot — an invisible handoff.
  React.useLayoutEffect(() => {
    const overlay = overlayRef.current;
    const t = transitionRef.current;
    const hero = heroImgRef.current;

    if (!overlay) return;

    const closeBtn = overlay.querySelector<HTMLElement>(`.${styles.close}`);
    // Images that rise into the row wait below it, hidden, with the × hidden
    // too; in a column they wait to its left and slide in, the row's rise
    // turned with it. The slots are shrunk into the row, so the rise is in
    // their own units.
    const holdBelow = (els: HTMLElement[]) => {
      for (const el of els) {
        el.style.transition = "none";
        el.style.opacity = "0";
        el.style.transform = vertical ? `translateX(${-RISE_PX / shrink}px)` : `translateY(${RISE_PX / shrink}px)`;
      }
      if (closeBtn) {
        closeBtn.style.transition = "none";
        closeBtn.style.opacity = "0";
      }
    };
    // Each rises from below into its slot, in a wave left to right.
    const riseIn = (els: HTMLElement[]) => {
      const delays = riseDelays(els.length);
      els.forEach((el, j) => {
        const delay = `${Math.round(delays[j])}ms`;
        el.style.transition = `opacity 0.45s ease ${delay}, transform ${RISE_MS}ms ${ENTRY_EASE} ${delay}`;
        el.style.opacity = "";
        el.style.transform = "";
      });
      if (closeBtn) {
        closeBtn.style.transition = "opacity 0.4s ease 0.3s";
        closeBtn.style.opacity = "";
      }
    };
    const clearTransitions = (els: HTMLElement[]) => {
      for (const el of els) el.style.transition = "";
      if (closeBtn) closeBtn.style.transition = "";
    };
    // Undo every inline style a run set, so a re-run starts clean
    const restore = (els: HTMLElement[]) => {
      for (const el of els) {
        el.style.transition = "";
        el.style.opacity = "";
        el.style.transform = "";
      }
      if (closeBtn) {
        closeBtn.style.transition = "";
        closeBtn.style.opacity = "";
      }
    };

    if (t?.sourceKey && hero) {
      const sourceKey = t.sourceKey;
      let canceled = false;
      // StrictMode runs this effect twice with a releaseTransition in between —
      // re-assert the hold, and only ever restore styles to "" (the class value)
      // so the second run can't capture the first run's frozen "0".
      holdTransition();
      overlay.style.background = "transparent";
      hero.style.opacity = "0";

      // Only after the hero has landed do the supporting images rise in.
      const satellites = Array.from(overlay.querySelectorAll<HTMLElement>("img[data-pos]")).filter((el) => el !== hero);
      holdBelow(satellites);

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
              riseIn(satellites);
              // The page covers the canvas from here until the exit.
              setCanvasPaused(true);
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
        }
      );

      // If the plane never arrives (edge: it unmounted), force the end state.
      const failSafe = setTimeout(() => {
        hero.style.transition = "";
        hero.style.opacity = "";
        hideTransitionSource(sourceKey);
        overlay.style.background = "";
        riseIn(satellites);
        setCanvasPaused(true);
      }, FLIGHT_MS + 800);

      const cleanup = setTimeout(
        () => clearTransitions(satellites),
        FLIGHT_MS + (riseDelays(satellites.length).at(-1) ?? 0) + RISE_MS + 500
      );

      return () => {
        canceled = true;
        clearTimeout(failSafe);
        clearTimeout(cleanup);
        setCanvasPaused(false);
        overlay.style.background = "";
        hero.style.transition = "";
        hero.style.opacity = "";
        restore(satellites);
      };
    }

    // Direct link (nothing flies in): the page is white from its first frame
    // and stays empty until every image in the row has loaded. Then the whole
    // row rises in, the first image leading, and the zoom follows as usual.
    // It used to fade in from transparent over the canvas, which showed black
    // before the canvas had drawn.
    const imgs = Array.from(overlay.querySelectorAll<HTMLImageElement>("img[data-pos]"));
    let canceled = false;
    let cleanup = 0;
    holdBelow(imgs);
    // The canvas never shows, so it doesn't run until the exit.
    setCanvasPaused(true);
    const loaded = (el: HTMLImageElement) =>
      el.complete
        ? Promise.resolve()
        : new Promise<void>((resolve) => {
            el.addEventListener("load", () => resolve(), { once: true });
            el.addEventListener("error", () => resolve(), { once: true });
          });
    Promise.race([Promise.all(imgs.map(loaded)), new Promise((resolve) => setTimeout(resolve, ROW_LOAD_MAX_MS))]).then(() => {
      if (canceled) return;
      riseIn(imgs);
      setArriving(true);
      cleanup = window.setTimeout(() => clearTransitions(imgs), (riseDelays(imgs.length).at(-1) ?? 0) + RISE_MS + 500);
    });
    return () => {
      canceled = true;
      clearTimeout(cleanup);
      setCanvasPaused(false);
      restore(imgs);
    };
  }, []);

  // Part 2, once the arrival has settled: the whole row zooms into the strip,
  // the image you clicked ending at the left edge.
  React.useEffect(() => {
    if (!arriving) return;
    // From the canvas, counted from the click: the flight, then the others'
    // wave. On a direct link, from when the row starts rising, all of it.
    const settleAt = flew
      ? FLIGHT_MS + (riseDelays(images.length - 1).at(-1) ?? 0) + RISE_MS + FUSE_PAUSE_MS
      : (riseDelays(images.length).at(-1) ?? 0) + RISE_MS + FUSE_PAUSE_MS;
    let canceled = false;
    // Run from script rather than as a CSS transition. A transition hands each
    // image to the compositor as its own layer, drawn once and then resized
    // every frame: PR-01's point-cloud images shimmered as that drawing was
    // resized and jumped when it was redrawn at the end, and 53 full-size
    // layers is more than the GPU keeps. Run from script, the strip is redrawn
    // at its real size each frame, and the last frame is the resting one.
    const zoom = () => {
      if (canceled) return;
      setPhase("strip");
      const slots = Array.from(rowRef.current?.children ?? []) as HTMLElement[];
      const t0 = performance.now();
      const frame = (now: number) => {
        if (canceled) return;
        const p = Math.min(1, (now - t0) / ZOOM_MS);
        const e = zoomEase(p);
        const scale = shrink + (1 - shrink) * e;
        slots.forEach((el, k) => {
          el.style.transform = `${along2d(rowStarts[k] + (starts[k] - rowStarts[k]) * e)} scale(${scale})`;
        });
        if (p < 1) rafRef.current = requestAnimationFrame(frame);
        else {
          setSettled(true);
          setBusy(false);
        }
      };
      rafRef.current = requestAnimationFrame(frame);
    };
    const timer = window.setTimeout(() => {
      // Like wakawaka.world, which waits on its hero images: hold the zoom until
      // the images that get big in it are decoded (started when the page
      // opened, below). Never longer than DECODE_WAIT_MS.
      const big = Array.from(overlayRef.current?.querySelectorAll<HTMLImageElement>("img[data-pos]") ?? []).filter(
        (el) => growsLarge[Number(el.dataset.pos)]
      );
      Promise.race([
        Promise.all(big.map((el) => el.decode().catch(() => {}))),
        new Promise((resolve) => setTimeout(resolve, DECODE_WAIT_MS)),
      ]).then(zoom);
    }, settleAt);
    return () => {
      canceled = true;
      clearTimeout(timer);
    };
  }, [arriving]);

  // Decode the images that get big in the zoom, at full size, as soon as the
  // page opens: the arrival leaves seconds for it. Only those: decoding every
  // image at full size up front (about 1GB for PR-01's 53) crowded out the ones
  // that matter; the rest decode small, as they're shown.
  React.useEffect(() => {
    for (const el of overlayRef.current?.querySelectorAll<HTMLImageElement>("img[data-pos]") ?? []) {
      if (growsLarge[Number(el.dataset.pos)]) el.decode().catch(() => {});
    }
  }, []);

  // After the zoom, the images that started as their 1500px copy, and that the
  // strip shows bigger than it, are upgraded to full size in strip order, a
  // couple at a time. Each is swapped in only once it's loaded and decoded, so
  // it just turns sharper: same size, no flash.
  React.useEffect(() => {
    if (!settled) return;
    let canceled = false;
    const queue = images.map((_, k) => k).filter((k) => !startsFull[k] && needsFull[k]);
    const work = async () => {
      for (let k = queue.shift(); k !== undefined && !canceled; k = queue.shift()) {
        const full = new Image();
        full.src = `/${images[k].url}`;
        await full.decode().catch(() => {});
        if (canceled) return;
        const done = k;
        setUpgraded((prev) => new Set(prev).add(done));
      }
    };
    for (let i = 0; i < UPGRADE_CONCURRENCY; i++) work();
    return () => {
      canceled = true;
    };
  }, [settled]);

  // Whatever the exit path, give the canvas back
  React.useEffect(() => releaseTransition, []);

  const fadeClose = () => {
    videos.hideAll();
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

  // Warm the canvas-size copy of whichever image you're on, so if you close on
  // it the plane has it straight away.
  const currentCanvasUrl = images[current]?.canvasUrl;
  React.useEffect(() => {
    if (currentCanvasUrl) new Image().src = `/${currentCanvasUrl}`;
  }, [currentCanvasUrl]);

  /**
   * Exit, from whichever image you're on. The plane you opened the project from
   * takes that image: once it's drawing it, the plane re-pins over the image and
   * flies home, shrinking to its canvas size while the camera centres it. Only
   * that image goes: the rest of the strip vanishes the moment you close (the
   * owner's pick in the Strip Flip bench, over the strip shrinking with it). The
   * canvas keeps the new image there.
   */
  const runExit = () => {
    if (busy) return;
    const t = transitionRef.current;
    const overlay = overlayRef.current;
    const k0 = current;
    const hero = overlay?.querySelector<HTMLImageElement>(`[data-pos="${k0}"]`);
    const item = images[k0];
    if (!t?.sourceKey || !hero || !overlay || !item) {
      fadeClose();
      return;
    }
    const sourceKey = t.sourceKey;
    videos.hideAll();
    setCanvasPaused(false);
    // Stop the strip wherever it is.
    stopScroll();
    dragRef.current = null;
    setDragging(false);
    setBusy(true);
    setPhase("leaving");

    // The rest of the strip is gone at once.
    for (const el of overlay.querySelectorAll<HTMLElement>("img[data-pos]")) {
      if (el === hero) continue;
      el.style.transition = "none";
      el.style.opacity = "0";
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
        "out"
      );
      hideTransitionSource(null);
      hero.style.opacity = "0";
      overlay.style.background = "transparent";
      after(CANVAS_RETURN_MS, returnCanvas);
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
      // exit needs a settled strip to work from, so interrupt with a plain fade.
      if (e.key === "Escape") (busy ? fadeClose : runExit)();
      if (phase !== "strip" || busy) return;
      const step = mainLen * KEY_STEP_FRAC;
      const forward = e.key === "ArrowRight" || (vertical && e.key === "ArrowDown");
      const back = e.key === "ArrowLeft" || (vertical && e.key === "ArrowUp");
      if (forward) scrollTo(scrollRef.current.target + step);
      if (back) scrollTo(scrollRef.current.target - step);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  React.useEffect(() => {
    const onWheel = (e: WheelEvent) => {
      // Nothing behind the page should scroll, and a sideways trackpad swipe
      // must not turn into the browser's back gesture.
      e.preventDefault();
      if (phase !== "strip" || busy) return;
      // Either axis moves the strip, so a mouse wheel works as well as a trackpad.
      const raw = Math.abs(e.deltaY) >= Math.abs(e.deltaX) ? e.deltaY : e.deltaX;
      const px = e.deltaMode === 1 ? raw * 16 : e.deltaMode === 2 ? raw * mainLen : raw;
      scrollTo(scrollRef.current.target + px);
    };
    window.addEventListener("wheel", onWheel, { passive: false });
    return () => window.removeEventListener("wheel", onWheel);
  });

  // Click and drag (mouse, pen or finger): the strip follows the pointer, then
  // carries on at the speed it was let go. Along the strip: sideways in a row,
  // up and down in a column.
  const alongPointer = (e: React.PointerEvent) => (vertical ? e.clientY : e.clientX);
  const onPointerDown = (e: React.PointerEvent) => {
    if (phase !== "strip" || busy || (e.pointerType === "mouse" && e.button !== 0)) return;
    if ((e.target as HTMLElement).closest("button, [data-vui]")) return;
    const slot = (e.target as HTMLElement).closest<HTMLElement>("[data-slot]");
    pressRef.current = { k: slot ? Number(slot.dataset.slot) : -1, x: e.clientX, y: e.clientY };
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    stopScroll();
    const pos = scrollRef.current.pos;
    const at = alongPointer(e);
    dragRef.current = { id: e.pointerId, x: at, from: pos, lastX: at, lastT: e.timeStamp, v: 0 };
    setDragging(true);
  };
  const onPointerMove = (e: React.PointerEvent) => {
    const d = dragRef.current;
    if (!d || d.id !== e.pointerId) return;
    const at = alongPointer(e);
    const dt = Math.max(1, e.timeStamp - d.lastT);
    d.v = 0.8 * ((d.lastX - at) / dt) + 0.2 * d.v;
    d.lastX = at;
    d.lastT = e.timeStamp;
    const pos = clamp(d.from - (at - d.x), 0, layoutRef.current.maxScroll);
    scrollRef.current.target = pos;
    applyScroll(pos);
  };
  const onPointerUp = (e: React.PointerEvent) => {
    const d = dragRef.current;
    if (!d || d.id !== e.pointerId) return;
    dragRef.current = null;
    setDragging(false);
    const v = e.timeStamp - d.lastT > FLING_STALE_MS ? 0 : d.v;
    const press = pressRef.current;
    pressRef.current = null;
    // A press that didn't move is a click: on a video, it centres and plays it.
    if (press && press.k >= 0 && Math.hypot(e.clientX - press.x, e.clientY - press.y) < 5) {
      videos.click(press.k);
      return;
    }
    scrollTo(scrollRef.current.pos + v * FLING_MS);
  };

  if (!images.length) return null;

  return (
    <div
      className={`${styles.overlay} ${vertical ? styles.vertical : ""} ${dragging ? styles.dragging : ""}`}
      ref={overlayRef}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
    >
      <button
        type="button"
        className={styles.close}
        onClick={runExit}
        style={phase === "leaving" ? { opacity: 0, transition: "opacity 0.3s ease" } : undefined}
      >
        ×
      </button>

      <div className={`${styles.counter} ${phase === "strip" ? styles.counterShown : ""}`}>{counter}</div>

      {videos.controls}

      <div className={styles.row} ref={rowRef}>
        {images.map((img, k) => (
          <div
            key={img.url}
            data-slot={k}
            className={`${styles.slot} ${videos.fitted === k ? styles.fitted : ""}`}
            style={{
              // Thick across the strip, long along it; centred across the window.
              ...(vertical
                ? { width: stripSize, height: lengths[k], marginLeft: -stripSize / 2 }
                : { width: lengths[k], height: stripSize, marginTop: -stripSize / 2 }),
              // The zoom runs from script and only hands back here once it's done.
              transform: settled ? `${along2d(starts[k])} scale(1)` : `${along2d(rowStarts[k])} scale(${shrink})`,
            }}
          >
            <img
              ref={k === 0 ? heroImgRef : null}
              data-pos={k}
              src={`/${startsFull[k] || upgraded.has(k) ? img.url : img.midUrl}`}
              alt=""
              draggable={false}
              decoding="async"
              className={styles.image}
            />
            {img.type === "video" && (
              <video
                ref={videos.refFor(k)}
                className={styles.video}
                muted
                loop
                playsInline
                preload="none"
                poster={`/${img.midUrl}`}
                // Fitted: longer than the window along the strip, it scales down to fit it.
                style={videos.fitted === k && lengths[k] > mainLen ? { transform: `scale(${mainLen / lengths[k]})` } : undefined}
                onPlaying={(e) => e.currentTarget.classList.add(styles.videoOn)}
              />
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
