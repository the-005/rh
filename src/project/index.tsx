import * as React from "react";
import allManifest from "~/src/images/manifest.json";
import type { MediaItem } from "~/src/infinite-canvas/types";
import { consumePendingTransition } from "./transition-origin";
import styles from "./style.module.css";

const ALL_MEDIA = allManifest as MediaItem[];

const SLOT_W = 380;

export function ProjectPage({ id, onClose }: { id: string; onClose: () => void }) {
  const images = React.useMemo(() => ALL_MEDIA.filter((item) => item.project === id), [id]);

  // Capture once on mount — clears the module-level store
  const transitionRef = React.useRef(consumePendingTransition());

  // Start at the image the user actually clicked, not index 0
  const [current, setCurrent] = React.useState(transitionRef.current?.startIndex ?? 0);

  const overlayRef = React.useRef<HTMLDivElement>(null);
  const centerImageRef = React.useRef<HTMLImageElement>(null);

  // FLIP entry: slide the clicked image from its canvas position to the centre
  React.useLayoutEffect(() => {
    const overlay = overlayRef.current;
    const t = transitionRef.current;
    const centerImg = centerImageRef.current;

    if (!overlay) return;

    if (t && centerImg) {
      const { rect } = t;

      // Freeze background as transparent; freeze image at canvas rect
      overlay.style.background = "transparent";
      centerImg.style.transition = "none";
      centerImg.style.left = `${rect.x + rect.width / 2}px`;
      centerImg.style.top = `${rect.y + rect.height / 2}px`;
      centerImg.style.height = `${rect.height}px`;
      centerImg.style.maxWidth = "none";

      const raf = requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          // Animate background and image to final state
          overlay.style.transition = "background 0.45s ease";
          overlay.style.background = "#eae8e4";

          centerImg.style.transition = [
            "left 0.55s cubic-bezier(0.22, 1, 0.36, 1)",
            "top 0.55s cubic-bezier(0.22, 1, 0.36, 1)",
            "height 0.55s cubic-bezier(0.22, 1, 0.36, 1)",
            "max-width 0.55s cubic-bezier(0.22, 1, 0.36, 1)",
          ].join(", ");
          centerImg.style.left = "calc(50% + 0px)";
          centerImg.style.top = "50%";
          centerImg.style.height = "78vh";
          centerImg.style.maxWidth = "44vw";
        });
      });

      // After FLIP completes, hand transition control back to the CSS class
      const cleanup = setTimeout(() => {
        centerImg.style.transition = "";
        centerImg.style.top = "";
        overlay.style.transition = "";
        overlay.style.background = "";
      }, 680);

      return () => {
        cancelAnimationFrame(raf);
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

  const advance = () => setCurrent((i) => (i + 1) % images.length);
  const goBack = () => setCurrent((i) => (i - 1 + images.length) % images.length);

  const handleClose = () => {
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
