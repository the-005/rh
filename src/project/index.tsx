import * as React from "react";
import allManifest from "~/src/images/manifest.json";
import type { MediaItem } from "~/src/infinite-canvas/types";
import { consumeTransitionOrigin } from "./transition-origin";
import styles from "./style.module.css";

const ALL_MEDIA = allManifest as MediaItem[];

// Horizontal distance between image centres (px)
const SLOT_W = 380;

export function ProjectPage({ id, onClose }: { id: string; onClose: () => void }) {
  const images = React.useMemo(() => ALL_MEDIA.filter((item) => item.project === id), [id]);

  const [current, setCurrent] = React.useState(0);
  const overlayRef = React.useRef<HTMLDivElement>(null);
  // Capture once on mount — consumeTransitionOrigin() clears the module-level store
  const originRef = React.useRef(consumeTransitionOrigin());

  // FLIP entry: expand from the click origin
  React.useLayoutEffect(() => {
    const el = overlayRef.current;
    const o = originRef.current;
    if (!el) return;

    if (o) {
      el.style.transformOrigin = `${o.x}px ${o.y}px`;
      el.style.transform = "scale(0.06)";
      el.style.opacity = "0";
    } else {
      el.style.opacity = "0";
    }

    const raf = requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        el.style.transition = o
          ? "transform 0.55s cubic-bezier(0.22, 1, 0.36, 1), opacity 0.25s"
          : "opacity 0.3s";
        el.style.transform = "";
        el.style.opacity = "1";
      });
    });

    return () => cancelAnimationFrame(raf);
  }, []);

  React.useEffect(() => {
    setCurrent(0);
  }, [id]);

  const advance = () => setCurrent((i) => (i + 1) % images.length);
  const goBack = () => setCurrent((i) => (i - 1 + images.length) % images.length);

  const handleClose = () => {
    const el = overlayRef.current;
    const o = originRef.current;
    if (el && o) {
      // Collapse back to the origin point, then hand off to parent
      el.style.transition = "transform 0.45s cubic-bezier(0.4, 0, 1, 1), opacity 0.3s";
      el.style.transformOrigin = `${o.x}px ${o.y}px`;
      el.style.transform = "scale(0.06)";
      el.style.opacity = "0";
      setTimeout(onClose, 450);
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
          const height = abs === 0 ? "78vh" : abs === 1 ? "24vh" : "14vh";
          const maxWidth = abs === 0 ? "44vw" : "20vw";
          const opacity = abs === 0 ? 1 : abs === 1 ? 0.55 : abs === 2 ? 0.25 : 0;

          return (
            <img
              key={img.url}
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
