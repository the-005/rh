import * as React from "react";
import manifest from "~/src/artworks/manifest.json";
import { Frame } from "~/src/frame";
import { InfiniteCanvas } from "~/src/infinite-canvas";
import type { MediaItem, SharedDragState, SharedPanState, SharedScrollState } from "~/src/infinite-canvas/types";
import { PageLoader } from "~/src/loader";
import styles from "./style.module.css";

export function App() {
  const [media] = React.useState<MediaItem[]>(manifest);
  const [textureProgress, setTextureProgress] = React.useState(0);

  const wrapperRef = React.useRef<HTMLDivElement>(null);
  const sharedScrollRef = React.useRef<SharedScrollState>({ accumulated: 0 });
  const sharedPanRef = React.useRef<SharedPanState>({ x: 0, y: 0, driftX: 0, driftY: 0 });
  const sharedDragRef = React.useRef<SharedDragState>({ isDragging: false });
  const splitRefs = { scrollRef: sharedScrollRef, panRef: sharedPanRef, dragRef: sharedDragRef };

  React.useEffect(() => {
    const el = wrapperRef.current;
    if (!el) return;

    let lastTouchDist = 0;

    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      sharedScrollRef.current.accumulated += e.deltaY * 0.006;
    };

    const onTouchStart = (e: TouchEvent) => {
      if (e.touches.length === 2) {
        const [t1, t2] = Array.from(e.touches);
        if (t1 && t2) {
          const dx = t1.clientX - t2.clientX;
          const dy = t1.clientY - t2.clientY;
          lastTouchDist = Math.sqrt(dx * dx + dy * dy);
        }
      }
    };

    const onTouchMove = (e: TouchEvent) => {
      if (e.touches.length === 2) {
        e.preventDefault();
        const [t1, t2] = Array.from(e.touches);
        if (t1 && t2 && lastTouchDist > 0) {
          const dx = t1.clientX - t2.clientX;
          const dy = t1.clientY - t2.clientY;
          const dist = Math.sqrt(dx * dx + dy * dy);
          sharedScrollRef.current.accumulated += (lastTouchDist - dist) * 0.006;
          lastTouchDist = dist;
        }
      }
    };

    el.addEventListener("wheel", onWheel, { passive: false });
    el.addEventListener("touchstart", onTouchStart, { passive: true });
    el.addEventListener("touchmove", onTouchMove, { passive: false });

    return () => {
      el.removeEventListener("wheel", onWheel);
      el.removeEventListener("touchstart", onTouchStart);
      el.removeEventListener("touchmove", onTouchMove);
    };
  }, []);

  if (!media.length) {
    return <PageLoader progress={0} />;
  }

  return (
    <>
      <Frame />
      <PageLoader progress={textureProgress} />
      <div ref={wrapperRef} className={styles.splitWrapper}>
        <div className={styles.splitPane}>
          <InfiniteCanvas
            media={media}
            onTextureProgress={setTextureProgress}
            splitRole="primary"
            splitRefs={splitRefs}
            zoomSign={1}
            side="left"
          />
        </div>
        <div className={styles.splitPane}>
          <InfiniteCanvas
            media={media}
            splitRole="secondary"
            splitRefs={splitRefs}
            zoomSign={-1}
            side="right"
          />
        </div>
      </div>
    </>
  );
}
