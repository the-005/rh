import * as React from "react";
import styles from "./style.module.css";

type Props = {
  videoSrc: string;
  onDismiss: (frameDataUrl: string, aspect: number) => void;
};

export function SplashVideo({ videoSrc, onDismiss }: Props) {
  const videoRef = React.useRef<HTMLVideoElement>(null);
  const [phase, setPhase] = React.useState<"visible" | "fading" | "done">("visible");
  const dismissedRef = React.useRef(false);

  const handleDismiss = () => {
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

    setPhase("fading");
  };

  if (phase === "done") return null;

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: full-screen splash overlay
    // biome-ignore lint/a11y/useKeyWithClickEvents: full-screen splash overlay
    <div
      className={`${styles.overlay}${phase === "fading" ? ` ${styles.fading}` : ""}`}
      onClick={phase === "visible" ? handleDismiss : undefined}
      onWheel={phase === "visible" ? handleDismiss : undefined}
      onTransitionEnd={() => { if (phase === "fading") setPhase("done"); }}
    >
      <video ref={videoRef} src={videoSrc} autoPlay muted loop playsInline className={styles.video} />
    </div>
  );
}
