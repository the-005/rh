import styles from "./style.module.css";

type Category = "all" | "art" | "commerce";

export function Frame({
  category,
  onCategoryChange,
}: {
  category: Category;
  onCategoryChange: (c: Category) => void;
}) {
  return (
    <header className={`frame ${styles.frame}`}>
      <nav className={styles.frame__filter}>
        {(["all", "art", "commerce"] as Category[]).map((c) => (
          <button
            key={c}
            type="button"
            className={`${styles.frame__filterBtn} ${category === c ? styles.frame__filterBtnActive : ""}`}
            onClick={() => onCategoryChange(c)}
          >
            {c}
          </button>
        ))}
      </nav>
    </header>
  );
}
