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
// Tile width at 100%, in px.
const BASE_TILE = 150;
// The slider's far end is one image per row, filling the page's width (≈700%
// at 1440 wide; it was 150%). It's measured from the grid, so every screen
// gets the same track: one per row starts at the tile width where the row
// only holds one, and runs on for as much of the track as two per row has.
// If the window is so narrow that's under 150%, the far end stays at 150%.
const MAX_FLOOR = 150;
// The track is logarithmic, as zoom sliders are: each step scales the tile by
// the same factor, so 50–150% keeps about half the track and the big sizes
// get the rest, instead of 50–150% being squeezed into the first fifth.
const TRACK = 1000;
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
  const [max, setMax] = React.useState(MAX_FLOOR * 3);
  const gridRef = React.useRef<HTMLDivElement>(null);

  // The far end. A row of R holds two tiles of t with gap g while 2t + g ≤ R,
  // so past (R − g) / 2 it holds one. Two per row spans tiles about 1.5× apart
  // ((R − 2g) / 3 to (R − g) / 2), so one per row gets the same 1.5×.
  React.useEffect(() => {
    const grid = gridRef.current;
    if (!grid) return;
    const measure = () => {
      const cs = getComputedStyle(grid);
      const row = grid.clientWidth - Number.parseFloat(cs.paddingLeft) - Number.parseFloat(cs.paddingRight);
      const gap = Number.parseFloat(cs.columnGap) || 0;
      setMax(Math.max(MAX_FLOOR, ((1.5 * (row - gap)) / 2 / BASE_TILE) * 100));
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(grid);
    return () => observer.disconnect();
  }, []);

  const shown = Math.min(scale, max);
  const toTrack = (value: number) => Math.round((TRACK * Math.log(value / MIN)) / Math.log(max / MIN));
  const fromTrack = (t: number) => MIN * (max / MIN) ** (t / TRACK);

  // Snap on release, never mid-drag. Arrow keys don't go through here at all:
  // they step one notch at a time and would be stuck on a stop if a notch past
  // it snapped back.
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
      {/* Centred, one line under the frame's Gallery and Index links. */}
      <div className={styles.scale}>
        <input
          type="range"
          className={styles.slider}
          min={0}
          max={TRACK}
          step={1}
          value={toTrack(shown)}
          aria-label="Grid scale"
          aria-valuetext={`${Math.round(shown)}%`}
          onPointerDown={snapOnRelease}
          onChange={(e) => setScale(fromTrack(e.currentTarget.valueAsNumber))}
        />
      </div>

      <div
        ref={gridRef}
        className={styles.grid}
        style={{ "--tile": `${(BASE_TILE * shown) / 100}px` } as React.CSSProperties}
      >
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
