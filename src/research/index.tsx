import * as React from "react";
import manifest from "./manifest.json";
import styles from "./style.module.css";

/**
 * Research: the work as a contact sheet. A plain grid, images at their own
 * aspect ratios and hung from the top of each row, with the scale steps from
 * the Codrops grid-layout-transition demo. What's dropped from the demo is its
 * numbering and its FLIP tween — a step here is a CSS column change that lands
 * in one frame, the way Eagle's zoom does. Tweening every tile to its new cell
 * sends them travelling diagonally across rows, which reads as lag.
 *
 * Images and their order come from `manifest.json`, written by
 * `npm run research:images` (see CLAUDE.md, "Research media").
 */

const SIZES = ["50%", "75%", "100%", "125%", "150%"] as const;
type Size = (typeof SIZES)[number];

export function ResearchPage() {
  const [size, setSize] = React.useState<Size>("75%");

  return (
    <main className={styles.page}>
      {/* Sits in the frame's top row, between the wordmark and the view nav. */}
      <nav className={styles.scale} aria-label="Grid scale">
        {SIZES.map((s) => (
          <button
            key={s}
            type="button"
            className={`${styles.step} ${size === s ? styles.stepActive : ""}`}
            aria-pressed={size === s}
            onClick={() => setSize(s)}
          >
            {s}
          </button>
        ))}
      </nav>

      <div className={styles.grid} data-size={size}>
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
