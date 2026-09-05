import { PROJECTS } from "~/src/projects";
import styles from "./style.module.css";

/**
 * The index: the same projects the gallery holds, read as a list instead of a
 * space. One row per project — number, title, year — on the white the project
 * page already uses, so the toggle reads as canvas → paper.
 */
export function IndexPage({
  category,
  onOpenProject,
}: {
  category: string;
  onOpenProject: (id: string) => void;
}) {
  const projects = category === "all" ? PROJECTS : PROJECTS.filter((p) => p.category === category);

  return (
    <main className={styles.page}>
      <div className={styles.inner}>
        <div className={styles.head}>
          <span>#</span>
          <span>Title</span>
          <span className={styles.year}>Year</span>
        </div>

        <ul className={styles.list}>
          {projects.map((project, i) => (
            <li key={project.id}>
              <button type="button" className={styles.row} onClick={() => onOpenProject(project.id)}>
                <span className={styles.num}>{String(i + 1).padStart(2, "0")}</span>
                <span className={styles.title}>{project.title}</span>
                <span className={styles.year}>{project.year}</span>
              </button>
            </li>
          ))}
        </ul>
      </div>
    </main>
  );
}
