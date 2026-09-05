import styles from "./style.module.css";

type Category = "all" | "art" | "commerce";
export type View = "gallery" | "index";

export function Frame({
  category,
  onCategoryChange,
  view,
  onViewChange,
  showViewToggle = true,
}: {
  category: Category;
  onCategoryChange: (c: Category) => void;
  view: View;
  onViewChange: (v: View) => void;
  showViewToggle?: boolean;
}) {
  return (
    <header className={`frame ${styles.frame}`}>
      <nav className={styles.frame__filter}>
        {(["all", "art", "commerce"] as Category[]).map((c) => (
          <button
            key={c}
            type="button"
            className={`${styles.frame__btn} ${category === c ? styles.frame__btnActive : ""}`}
            onClick={() => onCategoryChange(c)}
          >
            {c}
          </button>
        ))}
      </nav>

      {showViewToggle && (
        <nav className={styles.frame__view}>
          {(["gallery", "index"] as View[]).map((v) => (
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
