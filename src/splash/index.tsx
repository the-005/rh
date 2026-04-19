import * as React from "react";
import styles from "./style.module.css";

type Props = {
  videoSrc: string;
  onDismiss: (frameDataUrl: string, aspect: number) => void;
};

// Matches SplashPlane: height=40 world units, camera distance=100, fov=60°
const VISIBLE_WORLD_H = 2 * 100 * Math.tan((60 * Math.PI) / 180 / 2);
const SPLASH_WORLD_H = 40;

export function SplashVideo({ videoSrc, onDismiss }: Props) {
  const videoRef = React.useRef<HTMLVideoElement>(null);
  const [phase, setPhase] = React.useState<"visible" | "shrinking" | "fading" | "done">("visible");
  const [frameDataUrl, setFrameDataUrl] = React.useState<string | null>(null);
  const [shrinkScale, setShrinkScale] = React.useState({ x: 1, y: 1 });
  const dismissedRef = React.useRef(false);

  const handleDismiss = () => {
    if (dismissedRef.current) return;
    dismissedRef.current = true;

    const video = videoRef.current;
    const vw = video?.videoWidth || 1920;
    const vh = video?.videoHeight || 1080;
    const aspect = vw / vh;

    let dataUrl = "";
    if (video) {
      video.pause();
      const cvs = document.createElement("canvas");
      cvs.width = vw;
      cvs.height = vh;
      cvs.getContext("2d")?.drawImage(video, 0, 0, vw, vh);
      dataUrl = cvs.toDataURL("image/jpeg", 0.92);
    }

    // Scale the full-screen overlay down to match the canvas plane's screen footprint
    const sy = SPLASH_WORLD_H / VISIBLE_WORLD_H;
    const sx = (sy * aspect * window.innerHeight) / window.innerWidth;
    setShrinkScale({ x: sx, y: sy });
    setFrameDataUrl(dataUrl);
    onDismiss(dataUrl, aspect);
    setPhase("shrinking");
  };

  const handleTransitionEnd = (e: React.TransitionEvent) => {
    if (phase === "shrinking" && e.propertyName === "transform") setPhase("fading");
    if (phase === "fading" && e.propertyName === "opacity") setPhase("done");
  };

  if (phase === "done") return null;

  const isShrinking = phase === "shrinking" || phase === "fading";
  const isFading = phase === "fading";

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: full-screen splash overlay
    // biome-ignore lint/a11y/useKeyWithClickEvents: full-screen splash overlay
    <div
      className={`${styles.overlay}${isShrinking ? ` ${styles.shrinking}` : ""}`}
      style={
        isShrinking
          ? ({ "--sx": shrinkScale.x, "--sy": shrinkScale.y, opacity: isFading ? 0 : 1 } as React.CSSProperties)
          : undefined
      }
      onClick={phase === "visible" ? handleDismiss : undefined}
      onWheel={phase === "visible" ? handleDismiss : undefined}
      onTransitionEnd={handleTransitionEnd}
    >
      {frameDataUrl ? (
        <img src={frameDataUrl} alt="" className={styles.video} />
      ) : (
        <video ref={videoRef} src={videoSrc} autoPlay muted loop playsInline className={styles.video} />
      )}
    </div>
  );
}
