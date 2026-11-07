import * as React from "react";
import manifest from "./manifest.json";
import styles from "./style.module.css";

/**
 * Research: the work as a contact sheet, images at their own aspect ratios.
 * Two views, one per notch of the slider (the owner, 4 Nov): a contact sheet
 * where the page opens (after screenshots of Mark Sommerfeld's grid and the
 * Makeup Archive: small images, a lot of white between them, each centred on
 * its row), and a waterfall of three columns (each image going into the
 * shortest column so far, so the order still reads left to right). Before
 * that the notches were 7, 5 and 2 columns, all waterfalls (2 Nov), and before
 * that a free tile width from 50% to one image per row.
 *
 * Changing view moves every image from its place in one to its place in the
 * other (the owner asked for a moving transition, 4 Nov; until then a change
 * landed in a single frame, as Eagle's zoom does). So that the same elements
 * can glide, the script places every image itself, absolutely, from the
 * manifest's sizes, so nothing waits on loading. Each image is laid out at its
 * waterfall size and only scaled down for the sheet, so it is never drawn
 * blown up from a small one.
 *
 * Every edge lands on a whole device pixel (`snap`), sizes and places alike:
 * an image whose top or bottom fell between two pixels showed a light line
 * there, the page's white blended into its last row of pixels (the owner,
 * 7 Nov, on a phone: "a white strip line sometimes on the top of the image,
 * sometimes on the bottom"). The sheet scales each image's width and height
 * separately, by less than a pixel's difference, so both its edges land too.
 *
 * It started as the Codrops grid-layout-transition demo; its numbering, its
 * FLIP tween and its five scale buttons are gone.
 *
 * Images and their order come from `manifest.json`, written by
 * `npm run research:images` (see CLAUDE.md, "Research media").
 */

type Item = (typeof manifest)[number];
type Mode = "sheet" | "waterfall";

// The slider's notches, left to right.
const MODES: Mode[] = ["sheet", "waterfall"];

// The sheet: each image fits a square box this fraction of a column wide, its
// longest side the box's side, centred in it. The boxes sit on a square
// lattice, as far apart down as across, the first and last columns on the
// page's margins, and the sheet is centred in the window while it fits.
const SHEET_COLUMNS = 7;
const SHEET_BOX = 0.5;
// On a phone the sheet has fewer columns, so its images aren't specks (7
// across a phone made them 25px).
const PHONE_SHEET_COLUMNS = 4;

const WATERFALL_COLUMNS = 3;

// The move between the two views.
const MOVE_MS = 800;
const MOVE_EASE = "cubic-bezier(0.42, 0, 0.58, 1)";

// In rem: the page's margins, under the frame at the top and below the last
// image, and the waterfall's gap, across and down.
const SIDE_REM = 1.5;
const TOP_REM = 5;
const BOTTOM_REM = 6;
const GAP_REM = 1.5;
const PHONE_GAP_REM = 0.75;

// Phones: the sheet in fewer columns, a narrower gap in the waterfall, and a
// bigger slider to touch (the stylesheet).
const PHONE = "(max-width: 767px)";

type View = { width: number; height: number; rem: number; phone: boolean; dpr: number };
type Place = { x: number; y: number; sx: number; sy: number };

// Where every image goes in a view. Every image's box is its waterfall size
// (`boxes`); the sheet scales it down.
function layOut(items: Item[], mode: Mode, view: View) {
  const snap = (v: number) => Math.round(v * view.dpr) / view.dpr;
  const side = SIDE_REM * view.rem;
  const top = TOP_REM * view.rem;
  const bottom = BOTTOM_REM * view.rem;
  const inner = view.width - 2 * side;
  const gap = (view.phone ? PHONE_GAP_REM : GAP_REM) * view.rem;
  const column = snap((inner - (WATERFALL_COLUMNS - 1) * gap) / WATERFALL_COLUMNS);
  const boxes = items.map((item) => ({ width: column, height: snap((column * item.height) / item.width) }));

  if (mode === "waterfall") {
    const heights = new Array<number>(WATERFALL_COLUMNS).fill(0);
    const places = items.map((_, k): Place => {
      const i = heights.indexOf(Math.min(...heights));
      const place = { x: snap(side + i * (column + gap)), y: snap(top + heights[i]), sx: 1, sy: 1 };
      heights[i] += boxes[k].height + gap;
      return place;
    });
    return { boxes, places, height: top + Math.max(...heights) - gap + bottom };
  }

  const columns = view.phone ? PHONE_SHEET_COLUMNS : SHEET_COLUMNS;
  const box = (inner / columns) * SHEET_BOX;
  const pitch = box + (inner - columns * box) / (columns - 1);
  const rows = Math.ceil(items.length / columns);
  const sheetHeight = (rows - 1) * pitch + box;
  const sheetTop = top + Math.max(0, (view.height - top - bottom - sheetHeight) / 2);
  const places = items.map((item, i): Place => {
    const fit = box / Math.max(item.width, item.height);
    const width = snap(item.width * fit);
    const height = snap(item.height * fit);
    return {
      x: snap(side + (i % columns) * pitch + (box - width) / 2),
      y: snap(sheetTop + Math.floor(i / columns) * pitch + (box - height) / 2),
      sx: width / boxes[i].width,
      sy: height / boxes[i].height,
    };
  });
  return { boxes, places, height: Math.max(view.height, top + sheetHeight + bottom) };
}

function measure(main: HTMLElement, stage: HTMLElement): View {
  return {
    width: stage.clientWidth,
    height: main.clientHeight,
    rem: Number.parseFloat(getComputedStyle(document.documentElement).fontSize) || 12,
    phone: window.matchMedia(PHONE).matches,
    dpr: window.devicePixelRatio || 1,
  };
}

export function ResearchPage() {
  const [step, setStep] = React.useState(0);
  const [view, setView] = React.useState<View>(() => ({
    width: window.innerWidth,
    height: window.innerHeight,
    rem: 12,
    phone: window.matchMedia(PHONE).matches,
    dpr: window.devicePixelRatio || 1,
  }));
  const mainRef = React.useRef<HTMLElement>(null);
  const stageRef = React.useRef<HTMLDivElement>(null);
  // Where every image was drawn the moment the view changed, mid-move
  // included, and the scroll then: the next move starts from there.
  const fromRef = React.useRef<{ mode: Mode; scroll: number; transforms: string[] } | null>(null);

  const mode = MODES[step];
  const layout = layOut(manifest, mode, view);

  React.useLayoutEffect(() => {
    const main = mainRef.current;
    const stage = stageRef.current;
    if (!main || !stage) return;
    const update = () => {
      const next = measure(main, stage);
      setView((prev) =>
        prev.width === next.width &&
        prev.height === next.height &&
        prev.rem === next.rem &&
        prev.phone === next.phone &&
        prev.dpr === next.dpr
          ? prev
          : next
      );
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(main);
    observer.observe(stage);
    return () => observer.disconnect();
  }, []);

  // The move: each image starts where it was drawn and eases to its new place.
  // The page goes back to the top, and the start is shifted by as much, so
  // nothing jumps when the scroll does.
  React.useLayoutEffect(() => {
    const from = fromRef.current;
    const main = mainRef.current;
    const stage = stageRef.current;
    fromRef.current = null;
    if (!from || from.mode === mode || !main || !stage) return;
    main.scrollTop = 0;
    const shift = main.scrollTop - from.scroll;
    Array.from(stage.children as HTMLCollectionOf<HTMLElement>).forEach((el, i) => {
      for (const animation of el.getAnimations()) animation.cancel();
      el.animate([{ transform: `translate(0px, ${shift}px) ${from.transforms[i]}` }, { transform: el.style.transform }], {
        duration: MOVE_MS,
        easing: MOVE_EASE,
      });
    });
  }, [mode]);

  const change = (next: number) => {
    const main = mainRef.current;
    const stage = stageRef.current;
    if (main && stage) {
      fromRef.current = {
        mode,
        scroll: main.scrollTop,
        transforms: Array.from(stage.children, (el) => getComputedStyle(el).transform),
      };
    }
    setStep(next);
  };

  return (
    <main ref={mainRef} className={styles.page}>
      {/* Centred, one line under the frame's top row. */}
      <div className={styles.scale}>
        <input
          type="range"
          className={styles.slider}
          min={0}
          max={MODES.length - 1}
          step={1}
          value={step}
          aria-label="Grid scale"
          aria-valuetext={mode === "sheet" ? "Contact sheet" : `${WATERFALL_COLUMNS} columns`}
          onChange={(e) => change(e.currentTarget.valueAsNumber)}
        />
      </div>

      <div ref={stageRef} className={styles.stage} style={{ height: layout.height }}>
        {manifest.map((item, i) => {
          const { x, y, sx, sy } = layout.places[i];
          const box = layout.boxes[i];
          return (
            <img
              key={item.url}
              className={styles.image}
              src={`/${item.url}`}
              width={item.width}
              height={item.height}
              style={{
                width: box.width,
                height: box.height,
                transform: `translate(${x}px, ${y}px) scale(${sx}, ${sy})`,
              }}
              alt=""
              loading="lazy"
              decoding="async"
            />
          );
        })}
      </div>
    </main>
  );
}
