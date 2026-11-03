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
 * The slider has three notches, one per column count (the owner, 2 Nov; it
 * was a free tile width from 50% to one image per row). The first, where the
 * page opens, is a contact sheet instead of a waterfall (the owner, 4 Nov,
 * after screenshots of Mark Sommerfeld's grid and the Makeup Archive): small
 * images, a lot of white between them, each centred on its row. Each change lands in a
 * single frame, as Eagle's zoom does, rather than tweening tiles between cells
 * (that read as lag). The waterfall knows each image's height from the
 * manifest, so it places them without waiting for anything to load.
 *
 * Images and their order come from `manifest.json`, written by
 * `npm run research:images` (see CLAUDE.md, "Research media").
 */

// The slider's notches, left to right: smallest images first.
const COLUMNS = [7, 5, 2];

// The contact sheet (the first notch): each image fits a square box this
// fraction of a column wide, its longest side the box's side, centred in it.
// The boxes sit on a square lattice, as far apart down as across, the first and
// last columns on the page's margins.
const SHEET_BOX = 0.5;

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
  const [step, setStep] = React.useState(0);
  // The row the images share: its inner width and the gap between columns.
  const [row, setRow] = React.useState(() => ({
    width: window.innerWidth - 48,
    gap: 24,
    phone: window.matchMedia(PHONE).matches,
  }));
  const gridRef = React.useRef<HTMLDivElement>(null);
  const layout = new URLSearchParams(window.location.search).get("layout") === "grid" ? "grid" : "waterfall";

  const sheet = step === 0 && !row.phone;

  // The sheet and the waterfall are different elements, so this re-attaches
  // when one replaces the other. The sheet's gap is its own, so the gap kept is
  // the last one measured off the waterfall (or the grid). Measured before
  // paint, so a new layout never shows a frame laid out with the old gap.
  React.useLayoutEffect(() => {
    const grid = gridRef.current;
    if (!grid) return;
    const measure = () => {
      const cs = getComputedStyle(grid);
      const width = grid.clientWidth - Number.parseFloat(cs.paddingLeft) - Number.parseFloat(cs.paddingRight);
      const gap = Number.parseFloat(cs.columnGap) || 0;
      setRow((prev) => ({ width, gap: sheet ? prev.gap : gap, phone: window.matchMedia(PHONE).matches }));
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(grid);
    return () => observer.disconnect();
  }, [sheet]);

  const columns = row.phone ? 3 : COLUMNS[step];
  const columnWidth = (row.width - (columns - 1) * row.gap) / columns;
  const box = (row.width / columns) * SHEET_BOX;
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
  // On the sheet, an image is sized to its box from the manifest, so nothing
  // waits on loading to find its place.
  const fitted = (item: Item) => {
    const scale = box / Math.max(item.width, item.height);
    return (
      <div key={item.url} className={styles.cell}>
        <img
          className={styles.image}
          src={`/${item.url}`}
          width={item.width}
          height={item.height}
          style={{ width: item.width * scale, height: item.height * scale }}
          alt=""
          loading="lazy"
          decoding="async"
        />
      </div>
    );
  };

  return (
    <main className={styles.page}>
      {/* Centred, one line under the frame's Gallery and Index links. */}
      <div className={styles.scale}>
        <input
          type="range"
          className={styles.slider}
          min={0}
          max={COLUMNS.length - 1}
          step={1}
          value={step}
          aria-label="Grid scale"
          aria-valuetext={`${COLUMNS[step]} columns`}
          onChange={(e) => setStep(e.currentTarget.valueAsNumber)}
        />
      </div>

      {sheet ? (
        <div
          ref={gridRef}
          className={styles.sheet}
          style={
            {
              "--columns": columns,
              "--box": `${box}px`,
              "--sheet-gap": `${(row.width - columns * box) / (columns - 1)}px`,
            } as React.CSSProperties
          }
        >
          {manifest.map(fitted)}
        </div>
      ) : layout === "grid" ? (
        <div ref={gridRef} className={styles.grid} style={{ "--columns": columns } as React.CSSProperties}>
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
