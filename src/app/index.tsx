import * as React from "react";
import { useLocation } from "wouter";
import { AboutPage } from "~/src/about";
import { Frame, type View } from "~/src/frame";
import { IndexPage } from "~/src/index-page";
import { InfiniteCanvas } from "~/src/infinite-canvas";
import type { MediaItem } from "~/src/infinite-canvas/types";
import { ProjectPage } from "~/src/project";
import { setPendingIndex, setPendingTransition } from "~/src/project/transition-origin";
import { ResearchPage } from "~/src/research";
import { hasSeenSplash, SplashVideo } from "~/src/splash";
import allManifest from "~/src/work/manifest.json";

const ALL_MEDIA = allManifest as MediaItem[];

const VIEW_PATHS: Record<View, string> = { gallery: "/", index: "/index", research: "/research", about: "/about" };

// The intro splash plays once: not on a deep link (e.g. /project/x, whose page
// already covers the canvas), and not for a visitor who has seen it before.
const SKIP_SPLASH = window.location.pathname !== "/" || hasSeenSplash();

export function App() {
  const [location, navigate] = useLocation();
  const [splashFrame, setSplashFrame] = React.useState<string | null>(null);
  const [splashAspect, setSplashAspect] = React.useState(16 / 9);
  const [splashDismissed, setSplashDismissed] = React.useState(SKIP_SPLASH);

  const projectId = React.useMemo(() => {
    // Project ids are the client's folder names, which may hold spaces.
    const m = location.match(/^\/project\/([^/]+)$/);
    return m ? decodeURIComponent(m[1]) : null;
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
      navigate(`/project/${encodeURIComponent(item.project)}`);
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
      <InfiniteCanvas
        media={ALL_MEDIA}
        onMediaClick={handleMediaClick}
        cameraFov={48}
        splashSrc={splashFrame ?? undefined}
        splashAspect={splashAspect}
        onSplashReady={() => setSplashDismissed(true)}
        // Out of sight is gone for the visit: drop the frame and its texture.
        onSplashGone={() => setSplashFrame(null)}
      />
      {view === "research" && !projectId && <ResearchPage />}
      {view === "about" && !projectId && <AboutPage />}
      {view === "index" && !projectId && (
        <IndexPage
          onOpenProject={(id, startIndex) => {
            openedFromIndexRef.current = true;
            // Scrubbed to an image, so open on it — same startIndex the canvas
            // hands over, minus the plane flight.
            setPendingIndex(startIndex);
            navigate(`/project/${encodeURIComponent(id)}`);
          }}
        />
      )}
      {projectId && (
        <ProjectPage key={projectId} id={projectId} onClose={() => navigate(openedFromIndexRef.current ? "/index" : "/")} />
      )}
    </>
  );
}
