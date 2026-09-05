import * as React from "react";
import { PROJECTS } from "~/src/projects";
import styles from "./style.module.css";

/**
 * The index: the same projects the gallery holds, read as a list instead of a
 * space. One row per project — number, title, year — on the white the project
 * page already uses, so the toggle reads as canvas → paper. The list keeps to
 * the left half; hovering a row shows that project's cover in the right.
 */
export function IndexPage({ category, onOpenProject }: { category: string; onOpenProject: (id: string) => void }) {
  const projects = category === "all" ? PROJECTS : PROJECTS.filter((p) => p.category === category);
  const [hovered, setHovered] = React.useState<string | null>(null);

  // Covers are the same files the canvas already fetched as textures, so the
  // swap comes out of the browser cache rather than the network.
  const cover = projects.find((p) => p.id === hovered)?.cover;

  return (
    <main className={styles.page}>
      <div className={styles.inner}>
        <div className={styles.head}>
          <span>#</span>
          <span>Title</span>
          <span className={styles.year}>Year</span>
        </div>

        {/* biome-ignore lint/a11y/noNoninteractiveElementInteractions: clearing hover state on leave */}
        <ul className={styles.list} onMouseLeave={() => setHovered(null)}>
          {projects.map((project, i) => (
            <li key={project.id}>
              <button
                type="button"
                className={styles.row}
                onClick={() => onOpenProject(project.id)}
                onMouseEnter={() => setHovered(project.id)}
                onFocus={() => setHovered(project.id)}
              >
                <span className={styles.num}>{String(i + 1).padStart(2, "0")}</span>
                <span className={styles.title}>{project.title}</span>
                <span className={styles.year}>{project.year}</span>
              </button>
            </li>
          ))}
        </ul>
      </div>

      <div className={styles.preview} aria-hidden="true">
        {cover && <img key={cover} src={`/${cover}`} alt="" className={styles.previewImg} decoding="async" />}
      </div>
    </main>
  );
}
