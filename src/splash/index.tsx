import * as React from "react";
import { releaseImages } from "./hold";
import styles from "./style.module.css";

// A visitor sees the intro once. Kept in localStorage — a cookie in effect, but
// never sent to a server. index.html reads it before anything paints. Storage
// can be unavailable (private windows, blocked site data); then the splash
// simply plays, as it would on a first visit.
const SEEN_KEY = "rh:splash-seen";

// The splash is black until its video plays, never the gallery first (the
// owner, 7 Nov). If it hasn't started within GIVE_UP_MS, or can't autoplay at
// all (iPhones in Low Power Mode), it fades to the gallery over FADE_MS and
// stays unseen, so it plays on the next visit.
const GIVE_UP_MS = 4000;
const FADE_MS = 600;

function markSplashSeen() {
  try {
    localStorage.setItem(SEEN_KEY, "1");
  } catch {
    // Nothing to do: next visit plays it again.
  }
}

type Props = {
  visible: boolean;
  videoSrc: string;
  onDismiss: (frameDataUrl: string, aspect: number) => void;
  /** The splash gave up before its video played; the gallery is showing. */
  onSkip: () => void;
};

export function SplashVideo({ visible, videoSrc, onDismiss, onSkip }: Props) {
  const videoRef = React.useRef<HTMLVideoElement>(null);
  const dismissedRef = React.useRef(false);
  const playingRef = React.useRef(false);
  const [leaving, setLeaving] = React.useState(false);

  // Fades out to the gallery and stops the video's download, which would
  // otherwise go on taking the connection from the gallery's images.
  const giveUp = () => {
    if (dismissedRef.current) return;
    dismissedRef.current = true;
    const video = videoRef.current;
    if (video) {
      video.pause();
      video.removeAttribute("src");
      video.load();
    }
    releaseImages();
    setLeaving(true);
    setTimeout(onSkip, FADE_MS);
  };

  React.useEffect(() => {
    if (!visible) return;
    const timer = setTimeout(() => {
      if (!playingRef.current) giveUp();
    }, GIVE_UP_MS);
    // Blocked autoplay says so at once; no need to sit on black for the rest.
    videoRef.current?.play().catch((err: unknown) => {
      if (err instanceof DOMException && err.name === "NotAllowedError") giveUp();
    });
    return () => clearTimeout(timer);
  }, [visible]);

  if (!visible) return null;

  const handlePlaying = () => {
    if (dismissedRef.current) return;
    playingRef.current = true;
    // Seen once it actually plays, not merely once the page opened.
    markSplashSeen();
    releaseImages();
  };

  const handleWheel = () => {
    if (dismissedRef.current) return;
    // Before it plays there's no frame to carry into the gallery: go straight there.
    if (!playingRef.current) {
      giveUp();
      return;
    }
    dismissedRef.current = true;

    const video = videoRef.current;
    if (video) {
      video.pause();
      const w = video.videoWidth || 1920;
      const h = video.videoHeight || 1080;
      const cvs = document.createElement("canvas");
      cvs.width = w;
      cvs.height = h;
      cvs.getContext("2d")?.drawImage(video, 0, 0, w, h);
      onDismiss(cvs.toDataURL("image/jpeg", 0.92), w / h);
    }
  };

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: full-screen splash overlay
    <div
      className={`${styles.overlay} ${leaving ? styles.leaving : ""}`}
      style={{ "--fade": `${FADE_MS}ms` } as React.CSSProperties}
      onWheel={handleWheel}
    >
      <video ref={videoRef} src={videoSrc} autoPlay muted loop playsInline className={styles.video} onPlaying={handlePlaying} />
    </div>
  );
}
