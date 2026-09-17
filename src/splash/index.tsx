import * as React from "react";
import styles from "./style.module.css";

// A visitor sees the intro once. Kept in localStorage — a cookie in effect, but
// never sent to a server. Storage can be unavailable (private windows, blocked
// site data); then the splash simply plays, as it would on a first visit.
const SEEN_KEY = "rh:splash-seen";

export function hasSeenSplash() {
  try {
    return localStorage.getItem(SEEN_KEY) === "1";
  } catch {
    return false;
  }
}

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
};

export function SplashVideo({ visible, videoSrc, onDismiss }: Props) {
  const videoRef = React.useRef<HTMLVideoElement>(null);
  const dismissedRef = React.useRef(false);

  if (!visible) return null;

  const handleWheel = () => {
    if (dismissedRef.current) return;
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
    <div className={styles.overlay} onWheel={handleWheel}>
      {/* Seen once it actually plays, not merely once the page opened. */}
      <video ref={videoRef} src={videoSrc} autoPlay muted loop playsInline className={styles.video} onPlaying={markSplashSeen} />
    </div>
  );
}
