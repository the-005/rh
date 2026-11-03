import * as React from "react";
import { useLocation } from "wouter";
import { AboutPage } from "~/src/about";
import { Frame, type View } from "~/src/frame";
import { IndexPage } from "~/src/index-page";
import { InfiniteCanvas } from "~/src/infinite-canvas";
import { BEAT_MS, growGallery, hideGallery, INDEX_OUT_MS, shrinkGallery } from "~/src/infinite-canvas/view-shrink";
import type { MediaItem } from "~/src/infinite-canvas/types";
import { ProjectPage } from "~/src/project";
import { setPendingTransition } from "~/src/project/transition-origin";
import { ResearchPage } from "~/src/research";
import { SettingsPanel } from "~/src/settings";
import { SplashVideo } from "~/src/splash";
import { MEDIA } from "~/src/work/data";

// What the site shows, loaded before the app (src/work/data).
const ALL_MEDIA: MediaItem[] = MEDIA;

const VIEW_PATHS: Record<View, string> = { gallery: "/", index: "/index", research: "/research", about: "/about" };

// The intro splash plays once: not on a deep link (e.g. /project/x, whose page
// already covers the canvas), and not for a visitor who has seen it before.
// index.html decides, before anything paints, so the page's ground can match.
const SKIP_SPLASH = !document.documentElement.classList.contains("splash");

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

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

  // The index, research and about are routes, so they survive a reload and the back button.
  const view: View = (Object.keys(VIEW_PATHS) as View[]).find((v) => VIEW_PATHS[v] === location) ?? "gallery";

  // Gallery and index hand over to each other (src/infinite-canvas/view-shrink.ts):
  // to the index, the gallery's images shrink away, a beat of white, then the
  // index's rows fade in from the top and its picture last; back, the index
  // fades to white and the images grow where they were. The nav shows where
  // you're going as soon as you click.
  const [pendingView, setPendingView] = React.useState<View | null>(null);
  const [leavingIndex, setLeavingIndex] = React.useState(false);
  const switching = React.useRef(false);

  const goTo = async (next: View) => {
    if (switching.current || next === view) return;
    const handOver = !projectId && ((view === "gallery" && next === "index") || (view === "index" && next === "gallery"));
    if (!handOver) {
      navigate(VIEW_PATHS[next]);
      return;
    }
    switching.current = true;
    setPendingView(next);
    if (next === "index") {
      await shrinkGallery();
      await wait(BEAT_MS);
    } else {
      setLeavingIndex(true);
      await wait(INDEX_OUT_MS);
    }
    navigate(VIEW_PATHS[next]);
    setLeavingIndex(false);
    setPendingView(null);
    switching.current = false;
  };

  // Whatever the route (the back button included): the gallery's images are
  // away under the index, and back whenever the gallery is the view.
  React.useEffect(() => {
    if (projectId) return;
    if (view === "gallery") void growGallery();
    else if (view === "index") hideGallery();
  }, [view, projectId]);

  const handleMediaClick = (item: MediaItem, rect: { x: number; y: number; width: number; height: number }) => {
    if (item.project) {
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
        videoSrc="/splash.mp4"
        onDismiss={(frame, aspect) => {
          setSplashFrame(frame);
          setSplashAspect(aspect);
        }}
      />
      <Frame view={pendingView ?? view} onViewChange={goTo} showNav={!projectId} />
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
      {view === "index" && !projectId && <IndexPage leaving={leavingIndex} />}
      {projectId && <ProjectPage key={projectId} id={projectId} onClose={() => navigate("/")} />}
      <SettingsPanel />
    </>
  );
}
