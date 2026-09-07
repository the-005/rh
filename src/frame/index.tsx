import styles from "./style.module.css";

export type View = "gallery" | "index" | "about";

const NAV: View[] = ["gallery", "index", "about"];

export function Frame({
  view,
  onViewChange,
  showNav = true,
}: {
  view: View;
  onViewChange: (v: View) => void;
  showNav?: boolean;
}) {
  return (
    <header className={`frame ${styles.frame}`}>
      {/* Stands in for the logo: a wordmark holding the mark's corner, and the
          way back to the canvas from anywhere. */}
      <button type="button" className={styles.frame__home} onClick={() => onViewChange("gallery")}>
        Home
      </button>

      {showNav && (
        <nav className={styles.frame__view}>
          {NAV.map((v) => (
            <button
              key={v}
              type="button"
              className={`${styles.frame__btn} ${view === v ? styles.frame__btnActive : ""}`}
              onClick={() => onViewChange(v)}
            >
              {v}
            </button>
          ))}
        </nav>
      )}
    </header>
  );
}
