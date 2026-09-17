import * as React from "react";
import { useLocation } from "wouter";
import { AboutPage } from "~/src/about";
import { Frame, type View } from "~/src/frame";
import allManifest from "~/src/images/manifest.json";
import { IndexPage } from "~/src/index-page";
import { InfiniteCanvas } from "~/src/infinite-canvas";
import type { MediaItem } from "~/src/infinite-canvas/types";
import { PageLoader } from "~/src/loader";
import { ProjectPage } from "~/src/project";
import { setPendingIndex, setPendingTransition } from "~/src/project/transition-origin";
import { ResearchPage } from "~/src/research";
import { SplashVideo } from "~/src/splash";

const ALL_MEDIA = allManifest as MediaItem[];

// The category filter is off the frame — the top-left corner is the wordmark
// now. The canvas and the index still filter, so this is the one value they
// read; give it "art" or "commerce" to scope the whole site to a category.
const ACTIVE_CATEGORY = "all";

const VIEW_PATHS: Record<View, string> = { gallery: "/", index: "/index", research: "/research", about: "/about" };

// Whether this visit started somewhere other than the homepage (e.g. /project/x).
// Deep links skip the intro splash and the texture progress overlay — the project
// page is already covering the canvas while it loads.
const DEEP_LINKED = window.location.pathname !== "/";

export function App() {
  const [location, navigate] = useLocation();
  const [textureProgress, setTextureProgress] = React.useState(0);
  const [splashFrame, setSplashFrame] = React.useState<string | null>(null);
  const [splashAspect, setSplashAspect] = React.useState(16 / 9);
  const [splashDismissed, setSplashDismissed] = React.useState(DEEP_LINKED);

  const projectId = React.useMemo(() => {
    const m = location.match(/^\/project\/([^/]+)$/);
    return m ? m[1] : null;
  }, [location]);

  // The index, research and about are routes, so they survive a reload and the back
  // button, and so an index row can hand straight off to /project/:id.
  const view: View = (Object.keys(VIEW_PATHS) as View[]).find((v) => VIEW_PATHS[v] === location) ?? "gallery";
  // Closing a project returns you to whichever view opened it.
  const openedFromIndexRef = React.useRef(false);

  const handleMediaClick = (item: MediaItem, rect: { x: number; y: number; width: number; height: number }) => {
    if (item.project) {
      openedFromIndexRef.current = false;
      const projectImages = ALL_MEDIA.filter((m) => m.project === item.project);
      const startIndex = Math.max(
        0,
        projectImages.findIndex((m) => m.url === item.url)
      );
      setPendingTransition(rect, startIndex);
      navigate(`/project/${item.project}`);
    }
  };

  return (
    <>
      <SplashVideo
        visible={!splashDismissed}
        videoSrc="/PR-01_DE_58.mp4"
        onDismiss={(frame, aspect) => {
          setSplashFrame(frame);
          setSplashAspect(aspect);
        }}
      />
      <Frame view={view} onViewChange={(v) => navigate(VIEW_PATHS[v])} showNav={!projectId} />
      {!DEEP_LINKED && <PageLoader progress={textureProgress} />}
      <InfiniteCanvas
        media={ALL_MEDIA}
        activeCategory={ACTIVE_CATEGORY}
        onTextureProgress={setTextureProgress}
        onMediaClick={handleMediaClick}
        cameraFov={48}
        splashSrc={splashFrame ?? undefined}
        splashAspect={splashAspect}
        onSplashReady={() => setSplashDismissed(true)}
      />
      {view === "research" && !projectId && <ResearchPage />}
      {view === "about" && !projectId && <AboutPage />}
      {view === "index" && !projectId && (
        <IndexPage
          category={ACTIVE_CATEGORY}
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
        <ProjectPage key={projectId} id={projectId} onClose={() => navigate(openedFromIndexRef.current ? "/index" : "/")} />
      )}
    </>
  );
}
