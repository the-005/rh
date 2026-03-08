import * as React from "react";
import { useLocation } from "wouter";
import allManifest from "~/src/images/manifest.json";
import { Frame } from "~/src/frame";
import { InfiniteCanvas } from "~/src/infinite-canvas";
import type { MediaItem } from "~/src/infinite-canvas/types";
import { PageLoader } from "~/src/loader";
import { ProjectPage } from "~/src/project";
import { setTransitionOrigin } from "~/src/project/transition-origin";

type Category = "all" | "art" | "commerce";

const ALL_MEDIA = allManifest as MediaItem[];

export function App() {
  const [location, navigate] = useLocation();
  const [category, setCategory] = React.useState<Category>("all");
  const [textureProgress, setTextureProgress] = React.useState(0);

  // Derive active project from URL — canvas is always mounted underneath
  const projectId = React.useMemo(() => {
    const m = location.match(/^\/project\/([^/]+)$/);
    return m ? m[1] : null;
  }, [location]);

  const handleMediaClick = (item: MediaItem, x: number, y: number) => {
    if (item.project) {
      setTransitionOrigin(x, y);
      navigate(`/project/${item.project}`);
    }
  };

  return (
    <>
      <Frame category={category} onCategoryChange={setCategory} />
      <PageLoader progress={textureProgress} />
      {/* Canvas is never unmounted — no texture reload when returning from a project */}
      <InfiniteCanvas
        media={ALL_MEDIA}
        activeCategory={category}
        onTextureProgress={setTextureProgress}
        onMediaClick={handleMediaClick}
      />
      {projectId && (
        <ProjectPage id={projectId} onClose={() => navigate("/")} />
      )}
    </>
  );
}
