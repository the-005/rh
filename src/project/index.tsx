import * as React from "react";
import { useParams, useLocation } from "wouter";
import allManifest from "~/src/images/manifest.json";
import type { MediaItem } from "~/src/infinite-canvas/types";
import styles from "./style.module.css";

const ALL_MEDIA = allManifest as MediaItem[];

export function ProjectPage() {
  const params = useParams<{ id: string }>();
  const id = params.id;
  const [, navigate] = useLocation();

  const images = React.useMemo(() => ALL_MEDIA.filter((item) => item.project === id), [id]);

  const [currentIndex, setCurrentIndex] = React.useState(0);

  React.useEffect(() => {
    setCurrentIndex(0);
  }, [id]);

  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowLeft") {
        setCurrentIndex((i) => (i - 1 + images.length) % images.length);
      } else if (e.key === "ArrowRight") {
        setCurrentIndex((i) => (i + 1) % images.length);
      } else if (e.key === "Escape") {
        navigate("/");
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [images.length, navigate]);

  if (!images.length) {
    return (
      <div className={styles.overlay}>
        <button type="button" className={styles.close} onClick={() => navigate("/")}>
          ×
        </button>
        <p className={styles.empty}>Project not found.</p>
      </div>
    );
  }

  const current = images[currentIndex]!;

  return (
    <div className={styles.overlay}>
      <button type="button" className={styles.close} onClick={() => navigate("/")}>
        ×
      </button>

      <div className={styles.imageWrap}>
        <img
          key={current.url}
          src={`/${current.url}`}
          alt=""
          className={styles.image}
          draggable={false}
        />
      </div>

      <div className={styles.controls}>
        <button
          type="button"
          className={styles.arrow}
          onClick={() => setCurrentIndex((i) => (i - 1 + images.length) % images.length)}
          aria-label="Previous"
        >
          ←
        </button>
        <span className={styles.counter}>
          {currentIndex + 1} / {images.length}
        </span>
        <button
          type="button"
          className={styles.arrow}
          onClick={() => setCurrentIndex((i) => (i + 1) % images.length)}
          aria-label="Next"
        >
          →
        </button>
      </div>
    </div>
  );
}
