import * as React from "react";
import manifest from "./manifest.json";
import styles from "./style.module.css";

/**
 * Research: the work as a contact sheet, images at their own aspect ratios.
 * Laid out as a waterfall: columns of equal width, each image going into the
 * shortest column so far, so the order still reads left to right and every
 * column runs on at its own pace (the owner asked to try it, 2 Nov). The grid
 * it replaced, images hung from the top of each row, is still at
 * `/research?layout=grid` to compare. It started as the Codrops
 * grid-layout-transition demo; its numbering and its FLIP tween are gone, and
 * its five scale buttons became a slider.
 *
 * The slider sets a target tile width. Both layouts fit as many columns of at
 * least that width as the row holds and stretch them to fill it, so the
 * layout moves a column at a time and both edges stay put — Eagle's zoom, which
 * also lands each change in a single frame rather than tweening tiles between
 * cells (that read as lag). The waterfall knows each image's height from the
 * manifest, so it places them without waiting for anything to load.
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

type Item = (typeof manifest)[number];

// Phones get three columns, as in the demo (matches the stylesheet).
const PHONE = "(max-width: 767px)";

// Each image goes into the shortest column so far. Heights are in column
// widths (an image's height ÷ width), plus the gap between images.
function waterfall(items: Item[], columns: number, gapInWidths: number) {
  const cols: Item[][] = Array.from({ length: columns }, () => []);
  const heights = new Array<number>(columns).fill(0);
  for (const item of items) {
    const i = heights.indexOf(Math.min(...heights));
    cols[i].push(item);
    heights[i] += item.height / item.width + gapInWidths;
  }
  return cols;
}

export function ResearchPage() {
  const [scale, setScale] = React.useState(75);
  const [max, setMax] = React.useState(MAX_FLOOR * 3);
  // The row the images share: its inner width and the gap between columns.
  const [row, setRow] = React.useState(() => ({ width: window.innerWidth - 48, gap: 24, phone: window.matchMedia(PHONE).matches }));
  const gridRef = React.useRef<HTMLDivElement>(null);
  const layout = new URLSearchParams(window.location.search).get("layout") === "grid" ? "grid" : "waterfall";

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
      setRow({ width: row, gap, phone: window.matchMedia(PHONE).matches });
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(grid);
    return () => observer.disconnect();
  }, []);

  const shown = Math.min(scale, max);
  const tile = Math.min((BASE_TILE * shown) / 100, row.width);
  const columns = row.phone ? 3 : Math.max(1, Math.floor((row.width + row.gap) / (tile + row.gap)));
  const columnWidth = (row.width - (columns - 1) * row.gap) / columns;
  const image = (item: Item) => (
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
  );
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

      {layout === "grid" ? (
        <div
          ref={gridRef}
          className={styles.grid}
          style={{ "--tile": `${(BASE_TILE * shown) / 100}px` } as React.CSSProperties}
        >
          {manifest.map(image)}
        </div>
      ) : (
        <div ref={gridRef} className={styles.waterfall}>
          {waterfall(manifest, columns, row.gap / columnWidth).map((column, i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: columns have no identity beyond their place
            <div key={i} className={styles.column}>
              {column.map(image)}
            </div>
          ))}
        </div>
      )}
    </main>
  );
}
