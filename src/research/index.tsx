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
// Stops: letting go within SNAP of one lands on it, so a drag can wander
// anywhere and still settle on a round value. Everything further out stays
// where it was released — raise SNAP to 12.5 and every release snaps.
const STOPS = [50, 75, 100, 125, 150];
const SNAP = 6;

function snap(value: number) {
  const nearest = STOPS.reduce((a, b) => (Math.abs(b - value) < Math.abs(a - value) ? b : a));
  return Math.abs(nearest - value) <= SNAP ? nearest : value;
}

export function ResearchPage() {
  const [scale, setScale] = React.useState(75);

  // Snap on release, never mid-drag. Arrow keys don't go through here at all:
  // they step one at a time and would be stuck on a stop if 101 snapped back.
  const snapOnRelease = () => {
    const release = () => {
      window.removeEventListener("pointerup", release);
      window.removeEventListener("pointercancel", release);
      setScale((value) => snap(value));
    };
    window.addEventListener("pointerup", release);
    window.addEventListener("pointercancel", release);
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
          onPointerDown={snapOnRelease}
          onChange={(e) => setScale(e.currentTarget.valueAsNumber)}
        />
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
