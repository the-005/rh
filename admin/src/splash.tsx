import * as React from "react";
import { isVideo, keys, SITE_URL, type Splash } from "../shared.ts";
import { api, mediaUrl } from "./api.ts";
import { ICONS, type Tone } from "./editor.tsx";
import { upload } from "./upload.ts";
import "./material.ts";

// The splash: the video a first visit to the gallery opens on (the owner,
// 7 Nov). A new one is uploaded as it is and made into the site's version in
// the cloud; the site keeps the one it has until then. With none set here, the
// site plays its own (public/splash.mp4).
export function SplashSetting() {
  const [splash, setSplash] = React.useState<Splash | null>(null);
  const [uploading, setUploading] = React.useState<{ file: string; progress: number } | null>(null);
  const [error, setError] = React.useState("");
  const [over, setOver] = React.useState(false);
  const fileRef = React.useRef<HTMLInputElement>(null);

  const load = () => api.splash().then(setSplash, (e) => setError(e instanceof Error ? e.message : String(e)));
  React.useEffect(() => {
    load();
  }, []);

  // While a new one is being made, look again now and then.
  const making = !!splash?.next && splash.next.state !== "failed";
  React.useEffect(() => {
    if (!making) return;
    const timer = setInterval(load, 8000);
    return () => clearInterval(timer);
  }, [making]);

  async function replace(file: File | undefined) {
    if (!file || uploading) return;
    if (!isVideo(file.name, file.type)) {
      setError("That isn't a video.");
      return;
    }
    setError("");
    const item = crypto.randomUUID().slice(0, 8);
    const original = keys.splashOriginal(item, file.name);
    setUploading({ file: file.name, progress: 0 });
    try {
      await upload(original, file, (progress) => setUploading({ file: file.name, progress }));
      setSplash(await api.saveSplash({ item, file: file.name, original, size: file.size }));
    } catch (e) {
      setError(`Upload failed: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setUploading(null);
    }
  }

  const next = splash?.next;
  const name = uploading?.file ?? next?.file ?? splash?.current?.file ?? "Built-in video";
  const state: { tone: Tone; text: string; why?: string } | null = uploading
    ? { tone: "busy", text: `Uploading ${Math.floor(uploading.progress * 100)}%` }
    : error
      ? { tone: "error", text: error.startsWith("Upload failed") ? "Upload failed" : error, why: error }
      : next?.state === "failed"
        ? { tone: "error", text: "Couldn't process", why: next.message }
        : next?.state === "processing"
          ? { tone: "busy", text: "Processing" }
          : next
            ? { tone: "wait", text: "Waiting" }
            : null;
  const icon = state && ICONS[state.tone];
  const playing = splash?.current?.video ? mediaUrl(splash.current.video) : `${SITE_URL}/splash.mp4`;

  return (
    <section className="splash">
      <h2 className="md-typescale-title-large">Splash video</h2>
      <div
        className={over ? "splash-row over" : "splash-row"}
        onDragOver={(e) => {
          e.preventDefault();
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setOver(false);
          replace(e.dataTransfer.files[0]);
        }}
      >
        {splash ? <video src={playing} muted loop autoPlay playsInline /> : <span className="cover empty" />}
        <span className="row-text">
          <span className="name md-typescale-title-medium">{name}</span>
          <span className="meta md-typescale-body-medium">
            {state ? (
              <span className={`state ${state.tone}`} title={state.why}>
                {icon && <md-icon>{icon}</md-icon>}
                <span className="state-text">{state.text}</span>
              </span>
            ) : (
              "On the site"
            )}
          </span>
          {uploading && <md-linear-progress value={uploading.progress} />}
        </span>
        <md-outlined-button disabled={!!uploading} onClick={() => fileRef.current?.click()}>
          <md-icon slot="icon">swap_horiz</md-icon>
          <span className="label">Replace</span>
        </md-outlined-button>
        <input
          ref={fileRef}
          type="file"
          accept="video/*"
          hidden
          onChange={(e) => {
            replace(e.target.files?.[0]);
            e.target.value = "";
          }}
        />
      </div>
    </section>
  );
}
