import * as React from "react";
import allManifest from "~/src/images/manifest.json";
import type { MediaItem } from "~/src/infinite-canvas/types";
import {
  consumePendingTransition,
  hideTransitionSource,
  releaseTransitionSource,
} from "./transition-origin";
import styles from "./style.module.css";

const ALL_MEDIA = allManifest as MediaItem[];

const SLOT_W = 380;
const ENTRY_EASE = "cubic-bezier(0.22, 1, 0.36, 1)";

export function ProjectPage({ id, onClose }: { id: string; onClose: () => void }) {
  // Capture once on mount — clears the module-level store
  const transitionRef = React.useRef(consumePendingTransition());

  // Rotate the project's images so the clicked one is always first (counter reads 1/N)
  const filtered = ALL_MEDIA.filter((item) => item.project === id);
  const start = transitionRef.current?.startIndex ?? 0;
  const images = start > 0 ? [...filtered.slice(start), ...filtered.slice(0, start)] : filtered;

  const [current, setCurrent] = React.useState(0);

  const overlayRef = React.useRef<HTMLDivElement>(null);
  const centerImageRef = React.useRef<HTMLImageElement>(null);

  // FLIP entry: the clicked image tweens (transform-only, so compositor-cheap)
  // from its canvas rect to the centre slot while the rest of the page fades in.
  React.useLayoutEffect(() => {
    const overlay = overlayRef.current;
    const t = transitionRef.current;
    const img = centerImageRef.current;

    if (!overlay) return;

    if (t && img) {
      const { rect, opacity, sourceKey } = t;

      // Freeze: transparent background, chrome hidden, centre image over its canvas rect
      overlay.style.background = "transparent";

      const chrome = Array.from(
        overlay.querySelectorAll<HTMLElement>(
          `.${styles.image}, .${styles.close}, .${styles.counter}`,
        ),
      ).filter((el) => el !== img);
      const restore = chrome.map((el) => {
        const orig = el.style.opacity;
        el.style.transition = "none";
        el.style.opacity = "0";
        return { el, orig };
      });

      // Measure the final layout box, then transform back onto the canvas rect.
      // object-fit: contain letterboxes when the box aspect differs from the
      // image's, so map the visual image rect rather than the element box.
      img.style.transition = "none";
      const box = img.getBoundingClientRect();
      const aspect = rect.width / rect.height;
      const visualW = box.width / box.height > aspect ? box.height * aspect : box.width;
      const dx = rect.x + rect.width / 2 - (box.x + box.width / 2);
      const dy = rect.y + rect.height / 2 - (box.y + box.height / 2);
      const scale = rect.width / visualW;
      img.style.transform = `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px)) scale(${scale})`;
      img.style.opacity = String(opacity);

      let raf = 0;
      let cleanupTimer: ReturnType<typeof setTimeout> | undefined;

      const begin = () => {
        raf = requestAnimationFrame(() => {
          // The overlay image is now painted exactly over the canvas plane —
          // hide the plane so only one copy of the image ever moves.
          hideTransitionSource(sourceKey);
          raf = requestAnimationFrame(() => {
            overlay.style.transition = "background 0.55s ease";
            overlay.style.background = "#eae8e4";

            img.style.transition = `transform 0.9s ${ENTRY_EASE}, opacity 0.35s ease`;
            img.style.transform = "translate(-50%, -50%)";
            img.style.opacity = "1";

            // Supporting elements fade in staggered — farther (dimmer) ones later
            for (const { el, orig } of restore) {
              const target = orig === "" ? 1 : Number(orig);
              const delay = (0.3 + (1 - target) * 0.25).toFixed(2);
              el.style.transition = `opacity 0.55s ease ${delay}s`;
              el.style.opacity = orig;
            }
          });
        });

        // Hand control back to the CSS classes once the entry settles
        cleanupTimer = setTimeout(() => {
          img.style.transition = "";
          img.style.transform = "";
          img.style.opacity = "";
          overlay.style.transition = "";
          overlay.style.background = "";
          for (const { el } of restore) el.style.transition = "";
        }, 1300);
      };

      // Never start moving until the image can actually paint — the canvas plane
      // keeps showing underneath until then, so the wait is invisible.
      if (img.complete && img.naturalWidth > 0) begin();
      else img.decode().then(begin, begin);

      return () => {
        cancelAnimationFrame(raf);
        if (cleanupTimer) clearTimeout(cleanupTimer);
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

  // Whatever the exit path, give the hidden canvas plane back
  React.useEffect(() => releaseTransitionSource, []);

  const advance = () => setCurrent((i) => (i + 1) % images.length);
  const goBack = () => setCurrent((i) => (i - 1 + images.length) % images.length);

  const handleClose = () => {
    releaseTransitionSource();
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
      if (e.key === "ArrowRight") advance();
      else if (e.key === "ArrowLeft") goBack();
      else if (e.key === "Escape") handleClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const handleClick = (e: React.MouseEvent) => {
    if ((e.target as Element).closest("button")) return;
    if (e.clientX > window.innerWidth / 2) advance();
    else goBack();
  };

  if (!images.length) return null;

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: keyboard nav handled via window keydown
    // biome-ignore lint/a11y/useKeyWithClickEvents: keyboard nav handled via window keydown
    <div className={styles.overlay} ref={overlayRef} onClick={handleClick}>
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

      <div className={styles.stage}>
        {images.map((img, i) => {
          let offset = i - current;
          if (offset > images.length / 2) offset -= images.length;
          if (offset < -images.length / 2) offset += images.length;

          const abs = Math.abs(offset);
          const isCenter = abs === 0;
          const height = isCenter ? "78vh" : abs === 1 ? "24vh" : "14vh";
          const maxWidth = isCenter ? "44vw" : "20vw";
          const opacity = isCenter ? 1 : abs === 1 ? 0.55 : abs === 2 ? 0.25 : 0;

          return (
            <img
              key={img.url}
              ref={isCenter ? centerImageRef : null}
              src={`/${img.url}`}
              alt=""
              draggable={false}
              className={styles.image}
              style={{
                left: `calc(50% + ${offset * SLOT_W}px)`,
                height,
                maxWidth,
                opacity,
              }}
            />
          );
        })}
      </div>

      <span className={styles.counter}>
        {current + 1} / {images.length}
      </span>
    </div>
  );
}
