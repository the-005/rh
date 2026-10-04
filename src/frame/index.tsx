import styles from "./style.module.css";

export type View = "gallery" | "index" | "research" | "about";

/** The two ways through the work sit in the middle of the row; the rest at its right. */
const CENTRE: View[] = ["gallery", "index"];
const SIDE: View[] = ["research", "about"];
const LABELS: Record<View, string> = { gallery: "Gallery", index: "Index", research: "Research", about: "About" };

export function Frame({
  view,
  onViewChange,
  showNav = true,
}: {
  view: View;
  onViewChange: (v: View) => void;
  showNav?: boolean;
}) {
  const link = (v: View) => (
    <button
      key={v}
      type="button"
      className={`${styles.frame__btn} ${view === v ? styles.frame__btnActive : ""}`}
      onClick={() => onViewChange(v)}
    >
      {LABELS[v]}
    </button>
  );

  return (
    <header className={`frame ${styles.frame}`}>
      {/* Stands in for the logo: a wordmark holding the mark's corner, and the
          way back to the canvas from anywhere. */}
      <button type="button" className={styles.frame__home} onClick={() => onViewChange("gallery")}>
        Home
      </button>

      {showNav && (
        <>
          <nav className={styles.frame__centre} aria-label="Work">
            {CENTRE.map(link)}
          </nav>
          <nav className={styles.frame__view} aria-label="More">
            {SIDE.map(link)}
          </nav>
        </>
      )}
    </header>
  );
}
