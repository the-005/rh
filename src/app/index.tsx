import * as React from "react";
import { useLocation } from "wouter";
import allManifest from "~/src/images/manifest.json";
import { Frame } from "~/src/frame";
import { InfiniteCanvas } from "~/src/infinite-canvas";
import type { MediaItem } from "~/src/infinite-canvas/types";
import { PageLoader } from "~/src/loader";
import { ProjectPage } from "~/src/project";
import { setPendingTransition } from "~/src/project/transition-origin";
import { SplashVideo } from "~/src/splash";

type Category = "all" | "art" | "commerce";

const ALL_MEDIA = allManifest as MediaItem[];

export function App() {
  const [location, navigate] = useLocation();
  const [category, setCategory] = React.useState<Category>("all");
  const [textureProgress, setTextureProgress] = React.useState(0);
  const [splashFrame, setSplashFrame] = React.useState<string | null>(null);
  const [splashAspect, setSplashAspect] = React.useState(16 / 9);

  const projectId = React.useMemo(() => {
    const m = location.match(/^\/project\/([^/]+)$/);
    return m ? m[1] : null;
  }, [location]);

  const handleMediaClick = (item: MediaItem, rect: { x: number; y: number; width: number; height: number }) => {
    if (item.project) {
      const projectImages = ALL_MEDIA.filter((m) => m.project === item.project);
      const startIndex = Math.max(0, projectImages.findIndex((m) => m.url === item.url));
      setPendingTransition(rect, startIndex);
      navigate(`/project/${item.project}`);
    }
  };

  return (
    <>
      <SplashVideo
        videoSrc="/PR-01_DE_58.mp4"
        onDismiss={(frame, aspect) => { setSplashFrame(frame); setSplashAspect(aspect); }}
      />
      <Frame category={category} onCategoryChange={setCategory} />
      <PageLoader progress={textureProgress} />
      <InfiniteCanvas
        media={ALL_MEDIA}
        activeCategory={category}
        onTextureProgress={setTextureProgress}
        onMediaClick={handleMediaClick}
        cameraFov={60}
        showDebug
        showTuning
        splashSrc={splashFrame ?? undefined}
        splashAspect={splashAspect}
      />
      {projectId && <ProjectPage key={projectId} id={projectId} onClose={() => navigate("/")} />}
    </>
  );
}
