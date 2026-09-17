import * as React from "react";
import manifest from "./manifest.json";
import styles from "./style.module.css";

/**
 * Research: the work as a contact sheet. A plain grid, images at their own
 * aspect ratios and hung from the top of each row. It started as the Codrops
 * grid-layout-transition demo; its numbering and its FLIP tween are gone, and
 * its five scale buttons became a slider.
 *
 * The slider sets a target tile width. The grid fits as many columns of at
 * least that width as the row holds and stretches them to fill it, so the
 * layout moves a column at a time and both edges stay put — Eagle's zoom, which
 * also lands each change in a single frame rather than tweening tiles between
 * cells (that read as lag).
 *
 * Images and their order come from `manifest.json`, written by
 * `npm run research:images` (see CLAUDE.md, "Research media").
 */

const MIN = 50;
const MAX = 150;
// Tile width at 100%, in px.
const BASE_TILE = 150;
// Magnetic stops: a drag that passes within SNAP of one lands on it. On the
// 160px track that is about 5px either side, so everything between the stops
// stays easy to hit.
const STOPS = [50, 75, 100, 125, 150];
const SNAP = 3;

function snap(value: number) {
  const nearest = STOPS.reduce((a, b) => (Math.abs(b - value) < Math.abs(a - value) ? b : a));
  return Math.abs(nearest - value) <= SNAP ? nearest : value;
}

export function ResearchPage() {
  const [scale, setScale] = React.useState(75);
  // Only a drag snaps. Arrow keys move one at a time, and would be stuck on a
  // stop forever if 101 snapped back to 100.
  const draggingRef = React.useRef(false);

  const startDrag = () => {
    draggingRef.current = true;
    const end = () => {
      draggingRef.current = false;
    };
    window.addEventListener("pointerup", end, { once: true });
    window.addEventListener("pointercancel", end, { once: true });
  };

  return (
    <main className={styles.page}>
      {/* Sits in the frame's top row, between the wordmark and the view nav. */}
      <div className={styles.scale}>
        <input
          type="range"
          className={styles.slider}
          min={MIN}
          max={MAX}
          step={1}
          value={scale}
          aria-label="Grid scale"
          aria-valuetext={`${scale}%`}
          onPointerDown={startDrag}
          onChange={(e) => {
            const value = e.currentTarget.valueAsNumber;
            setScale(draggingRef.current ? snap(value) : value);
          }}
        />
        <output className={styles.readout}>{scale}%</output>
      </div>

      <div className={styles.grid} style={{ "--tile": `${(BASE_TILE * scale) / 100}px` } as React.CSSProperties}>
        {manifest.map((item) => (
          <img
            key={item.url}
            className={styles.image}
            src={`/${item.url}`}
            width={item.width}
            height={item.height}
            alt=""
            loading="lazy"
            decoding="async"
          />
        ))}
      </div>
    </main>
  );
}
