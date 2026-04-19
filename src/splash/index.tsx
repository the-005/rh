import * as React from "react";
import styles from "./style.module.css";

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
      <video ref={videoRef} src={videoSrc} autoPlay muted loop playsInline className={styles.video} />
    </div>
  );
}
