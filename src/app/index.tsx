import * as React from "react";
import { useLocation } from "wouter";
import allManifest from "~/src/images/manifest.json";
import { Frame, type View } from "~/src/frame";
import { InfiniteCanvas } from "~/src/infinite-canvas";
import { IndexPage } from "~/src/index-page";
import type { MediaItem } from "~/src/infinite-canvas/types";
import { PageLoader } from "~/src/loader";
import { ProjectPage } from "~/src/project";
import { setPendingIndex, setPendingTransition } from "~/src/project/transition-origin";
import { SplashVideo } from "~/src/splash";

type Category = "all" | "art" | "commerce";

const ALL_MEDIA = allManifest as MediaItem[];

// Whether this visit started somewhere other than the homepage (e.g. /project/x).
// Deep links skip the intro splash and the texture progress overlay — the project
// page is already covering the canvas while it loads.
const DEEP_LINKED = window.location.pathname !== "/";

export function App() {
  const [location, navigate] = useLocation();
  const [category, setCategory] = React.useState<Category>("all");
  const [textureProgress, setTextureProgress] = React.useState(0);
  const [splashFrame, setSplashFrame] = React.useState<string | null>(null);
  const [splashAspect, setSplashAspect] = React.useState(16 / 9);
  const [splashDismissed, setSplashDismissed] = React.useState(DEEP_LINKED);

  const projectId = React.useMemo(() => {
    const m = location.match(/^\/project\/([^/]+)$/);
    return m ? m[1] : null;
  }, [location]);

  // The index is a route so it survives a reload and the back button, and so a
  // row can hand straight off to /project/:id.
  const view: View = location === "/index" ? "index" : "gallery";
  // Closing a project returns you to whichever view opened it.
  const openedFromIndexRef = React.useRef(false);

  const handleMediaClick = (item: MediaItem, rect: { x: number; y: number; width: number; height: number }) => {
    if (item.project) {
      openedFromIndexRef.current = false;
      const projectImages = ALL_MEDIA.filter((m) => m.project === item.project);
      const startIndex = Math.max(0, projectImages.findIndex((m) => m.url === item.url));
      setPendingTransition(rect, startIndex);
      navigate(`/project/${item.project}`);
    }
  };

  return (
    <>
      <SplashVideo
        visible={!splashDismissed}
        videoSrc="/PR-01_DE_58.mp4"
        onDismiss={(frame, aspect) => { setSplashFrame(frame); setSplashAspect(aspect); }}
      />
      <Frame
        category={category}
        onCategoryChange={setCategory}
        view={view}
        onViewChange={(v) => navigate(v === "index" ? "/index" : "/")}
        showViewToggle={!projectId}
      />
      {!DEEP_LINKED && <PageLoader progress={textureProgress} />}
      <InfiniteCanvas
        media={ALL_MEDIA}
        activeCategory={category}
        onTextureProgress={setTextureProgress}
        onMediaClick={handleMediaClick}
        cameraFov={48}
        splashSrc={splashFrame ?? undefined}
        splashAspect={splashAspect}
        onSplashReady={() => setSplashDismissed(true)}
      />
      {view === "index" && !projectId && (
        <IndexPage
          category={category}
          onOpenProject={(id, startIndex) => {
            openedFromIndexRef.current = true;
            // Scrubbed to an image, so open on it — same startIndex the canvas
            // hands over, minus the plane flight.
            setPendingIndex(startIndex);
            navigate(`/project/${id}`);
          }}
        />
      )}
      {projectId && (
        <ProjectPage
          key={projectId}
          id={projectId}
          onClose={() => navigate(openedFromIndexRef.current ? "/index" : "/")}
        />
      )}
    </>
  );
}
