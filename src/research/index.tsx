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
 * was a free tile width from 50% to one image per row). Each change lands in a
 * single frame, as Eagle's zoom does, rather than tweening tiles between cells
 * (that read as lag). The waterfall knows each image's height from the
 * manifest, so it places them without waiting for anything to load.
 *
 * Images and their order come from `manifest.json`, written by
 * `npm run research:images` (see CLAUDE.md, "Research media").
 */

// The slider's notches, left to right: smallest images first.
const COLUMNS = [7, 5, 2];

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
  const [row, setRow] = React.useState(() => ({ width: window.innerWidth - 48, gap: 24, phone: window.matchMedia(PHONE).matches }));
  const gridRef = React.useRef<HTMLDivElement>(null);
  const layout = new URLSearchParams(window.location.search).get("layout") === "grid" ? "grid" : "waterfall";

  React.useEffect(() => {
    const grid = gridRef.current;
    if (!grid) return;
    const measure = () => {
      const cs = getComputedStyle(grid);
      const width = grid.clientWidth - Number.parseFloat(cs.paddingLeft) - Number.parseFloat(cs.paddingRight);
      const gap = Number.parseFloat(cs.columnGap) || 0;
      setRow({ width, gap, phone: window.matchMedia(PHONE).matches });
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(grid);
    return () => observer.disconnect();
  }, []);

  const columns = row.phone ? 3 : COLUMNS[step];
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

      {layout === "grid" ? (
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
