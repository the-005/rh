import * as React from "react";
import { isVideo, keys, SITE_URL, type Splash } from "../shared.ts";
import { api, mediaUrl } from "./api.ts";
import { upload } from "./upload.ts";
import { Group, Icon, State, type Tone } from "./ui.tsx";

// Moving pictures only when people haven't asked for less motion.
const stillOnly = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;

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
      setError("Choose a video file, such as an MP4 or MOV.");
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
      setError(`The upload stopped: ${e instanceof Error ? e.message : String(e)}. Try again.`);
    } finally {
      setUploading(null);
    }
  }

  const next = splash?.next;
  const name = uploading?.file ?? next?.file ?? splash?.current?.file ?? "Built-In Video";
  const state: { tone: Tone; text: string; why?: string } = uploading
    ? { tone: "busy", text: `Uploading ${Math.floor(uploading.progress * 100)}%` }
    : error
      ? { tone: "error", text: "Not Replaced", why: error }
      : next?.state === "failed"
        ? { tone: "error", text: "Couldn’t Process", why: next.message }
        : next?.state === "processing"
          ? { tone: "busy", text: "Processing" }
          : next
            ? { tone: "wait", text: "Waiting" }
            : { tone: "plain", text: "On the Site" };
  const playing = splash?.current?.video ? mediaUrl(splash.current.video) : `${SITE_URL}/splash.mp4`;
  const still = stillOnly();

  return (
    <Group
      header="Splash Video"
      footer={error || "Plays when someone first opens the site."}
      className={over ? "over" : undefined}
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
      <div className="row splash-row">
        {splash ? (
          <video
            className="cover"
            src={still ? `${playing}#t=2` : playing}
            muted
            loop
            autoPlay={!still}
            playsInline
            preload="metadata"
            aria-label="The splash video on the site"
          />
        ) : (
          <span className="cover" />
        )}
        <span className="row-text">
          <span className="row-title file-name">{name}</span>
          <span className="meta">
            <State {...state} />
          </span>
          {uploading && <progress className="progress" value={uploading.progress} />}
        </span>
        <button type="button" className="plain" disabled={!!uploading} onClick={() => fileRef.current?.click()}>
          <Icon name="swap_horiz" />
          <span className="label">Replace…</span>
        </button>
      </div>
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
    </Group>
  );
}
