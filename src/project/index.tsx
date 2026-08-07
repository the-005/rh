import * as React from "react";
import allManifest from "~/src/images/manifest.json";
import type { MediaItem } from "~/src/infinite-canvas/types";
import {
  beginHeroTween,
  consumePendingTransition,
  hideTransitionSource,
  releaseTransition,
} from "./transition-origin";
import styles from "./style.module.css";

const ALL_MEDIA = allManifest as MediaItem[];

const MARGIN = 40;
const GAP = 8;
/** Row height never exceeds this fraction of the viewport (small projects). */
const MAX_ROW_HEIGHT_FRAC = 0.5;
const FLIGHT_MS = 1000;

export function ProjectPage({ id, onClose }: { id: string; onClose: () => void }) {
  // Capture once on mount — clears the module-level store
  const transitionRef = React.useRef(consumePendingTransition());

  // Rotate the project's images so the clicked one is always first (leftmost)
  const filtered = ALL_MEDIA.filter((item) => item.project === id);
  const start = transitionRef.current?.startIndex ?? 0;
  const images = start > 0 ? [...filtered.slice(start), ...filtered.slice(0, start)] : filtered;

  const [viewport, setViewport] = React.useState({ w: window.innerWidth, h: window.innerHeight });
  React.useEffect(() => {
    const onResize = () => setViewport({ w: window.innerWidth, h: window.innerHeight });
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  // One row, all images at equal height, scaled down until the row fits the screen
  const aspects = images.map((img) => img.width / img.height);
  const sumAspect = aspects.reduce((sum, a) => sum + a, 0);
  const availW = viewport.w - MARGIN * 2 - GAP * (images.length - 1);
  const rowH = Math.min(viewport.h * MAX_ROW_HEIGHT_FRAC, availW / Math.max(sumAspect, 0.0001));

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
      overlay.style.background = "transparent";
      hero.style.opacity = "0";

      const others = Array.from(
        overlay.querySelectorAll<HTMLElement>(`.${styles.image}, .${styles.close}`),
      ).filter((el) => el !== hero);
      const restore = others.map((el) => {
        const orig = el.style.opacity;
        el.style.transition = "none";
        el.style.opacity = "0";
        return { el, orig };
      });

      // Supporting images fade in while the hero is still in flight (out and in
      // overlap), staggered left to right: 0.25s + j * 0.08s.
      let raf = requestAnimationFrame(() => {
        raf = requestAnimationFrame(() => {
          restore.forEach(({ el, orig }, j) => {
            el.style.transition = `opacity 0.5s ease ${(0.25 + j * 0.08).toFixed(2)}s`;
            el.style.opacity = orig;
          });
        });
      });

      const reveal = () => {
        requestAnimationFrame(() => {
          hero.style.transition = "none";
          hero.style.opacity = "";
          requestAnimationFrame(() => {
            hideTransitionSource(sourceKey);
            overlay.style.background = "";
            hero.style.transition = "";
          });
        });
      };

      const heroRect = hero.getBoundingClientRect();
      beginHeroTween(
        sourceKey,
        { x: heroRect.x, y: heroRect.y, width: heroRect.width, height: heroRect.height },
        FLIGHT_MS,
        () => {
          if (hero.complete && hero.naturalWidth > 0) reveal();
          else hero.decode().then(reveal, reveal);
        },
      );

      // If the plane never arrives (edge: it unmounted), force the end state.
      const failSafe = setTimeout(() => {
        hero.style.transition = "";
        hero.style.opacity = "";
        hideTransitionSource(sourceKey);
        overlay.style.background = "";
      }, FLIGHT_MS + 800);

      const cleanup = setTimeout(() => {
        for (const { el } of restore) el.style.transition = "";
      }, 2500);

      return () => {
        cancelAnimationFrame(raf);
        clearTimeout(failSafe);
        clearTimeout(cleanup);
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

  // Whatever the exit path, give the canvas back
  React.useEffect(() => releaseTransition, []);

  const handleClose = () => {
    releaseTransition();
    const overlay = overlayRef.current;
    if (overlay) {
      overlay.style.transition = "opacity 0.3s ease";
      overlay.style.opacity = "0";
      setTimeout(onClose, 320);
    } else {
      onClose();
    }
  };

  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") handleClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  if (!images.length) return null;

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: Escape handled via window keydown
    // biome-ignore lint/a11y/useKeyWithClickEvents: Escape handled via window keydown
    <div className={styles.overlay} ref={overlayRef} onClick={handleClose}>
      <button
        type="button"
        className={styles.close}
        onClick={(e) => {
          e.stopPropagation();
          handleClose();
        }}
      >
        ×
      </button>

      <div className={styles.row}>
        {images.map((img, i) => (
          <img
            key={img.url}
            ref={i === 0 ? heroImgRef : null}
            src={`/${img.url}`}
            alt=""
            draggable={false}
            decoding="async"
            className={styles.image}
            style={{ width: aspects[i] * rowH, height: rowH }}
          />
        ))}
      </div>
    </div>
  );
}
