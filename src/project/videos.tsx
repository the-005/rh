import * as React from "react";
import type { MediaItem } from "~/src/infinite-canvas/types";
import styles from "./style.module.css";

/**
 * Videos in the project strip, as approved in the Strip Video Bench (2 Nov,
 * https://claude.ai/artifact/9sSRfagsPJyATJoHNjHTR9), now that storage hosts
 * them (4 Nov).
 *
 * Each video rests as its still (its first frame, the slot's <img>, so the
 * arrival, zoom, upgrades and exit treat it like any picture), with the video
 * over it. The video taking up most of the screen plays, muted and looping;
 * the next one down the strip loads its first seconds; the rest load nothing.
 * Clicking a video centres it, fits it to the screen if it's wider, plays it
 * and shows its controls (Play, the line with its playhead, Unmute), drawn
 * light and blended like the counter; they fade a moment after the last touch.
 * Scrolling away from a fitted video puts it back, and mutes it.
 */

const UI_IDLE_MS = 1200; // the controls fade this long after the last click or touch of them
export const UNFIT_PX = 40; // scrolling this far from a fitted video puts it back in the strip
const MARGIN = 18; // the controls keep this far from the screen's edges

type Options = {
  items: MediaItem[];
  current: number;
  // In the strip, not arriving or leaving.
  active: boolean;
  // Scrolls the strip to centre slot k, returning the scroll position it heads for.
  centre: (k: number) => number;
};

export function useStripVideos({ items, current, active, centre }: Options) {
  const els = React.useRef<(HTMLVideoElement | null)[]>([]);
  const loaded = React.useRef(new Set<number>());
  const userPaused = React.useRef(new Set<number>());
  const fit = React.useRef<{ k: number; pos: number; centring: boolean } | null>(null);
  const [fitted, setFitted] = React.useState<number | null>(null);
  // The video the controls belong to, and whether they're showing.
  const [uiFor, setUiFor] = React.useState<number | null>(null);
  const [uiOn, setUiOn] = React.useState(false);
  const idle = React.useRef(0);
  const seeking = React.useRef(false);
  const vui = React.useRef<HTMLFieldSetElement>(null);
  const head = React.useRef<HTMLSpanElement>(null);
  const playButton = React.useRef<HTMLButtonElement>(null);
  const muteButton = React.useRef<HTMLButtonElement>(null);
  const track = React.useRef<HTMLDivElement>(null);

  const load = (k: number, preload: "auto" | "metadata") => {
    const v = els.current[k];
    const src = items[k]?.video;
    if (!v || !src) return;
    v.preload = preload;
    if (!loaded.current.has(k)) {
      v.src = `/${src}`;
      loaded.current.add(k);
    }
  };

  const unfit = () => {
    const f = fit.current;
    if (!f) return;
    const v = els.current[f.k];
    if (v) v.muted = true;
    fit.current = null;
    setFitted(null);
  };

  // Which video plays, which one loads ahead, and the rest wait.
  React.useEffect(() => {
    const f = fit.current;
    const playing = !active ? null : f?.centring ? f.k : items[current]?.type === "video" ? current : null;
    const next = active ? items.findIndex((item, k) => k > current && item.type === "video") : -1;
    items.forEach((item, k) => {
      if (item.type !== "video") return;
      const v = els.current[k];
      if (!v) return;
      if (k === playing) {
        load(k, "auto");
        if (v.paused && !userPaused.current.has(k)) v.play().catch(() => {});
      } else {
        if (k === next) load(k, "metadata");
        if (!v.paused) v.pause();
        v.muted = true; // scrolling away mutes it
        userPaused.current.delete(k);
      }
    });
    if (f && f.k !== playing && !f.centring) unfit();
  });

  const showUI = (k: number) => {
    setUiFor(k);
    setUiOn(true);
    window.clearTimeout(idle.current);
    idle.current = window.setTimeout(() => {
      if (!seeking.current) setUiOn(false);
    }, UI_IDLE_MS);
  };

  const fitVideo = (k: number) => {
    const pos = centre(k);
    fit.current = { k, pos, centring: true };
    setFitted(k);
    load(k, "auto");
    const v = els.current[k];
    if (v) {
      v.classList.add(styles.videoOn);
      if (v.paused) v.play().catch(() => {});
    }
    userPaused.current.delete(k);
    showUI(k);
  };

  const togglePlay = (k: number) => {
    const v = els.current[k];
    if (!v) return;
    if (k !== current && fitted !== k) {
      fitVideo(k);
      return;
    }
    load(k, "auto");
    if (v.paused) {
      v.play().catch(() => {});
      userPaused.current.delete(k);
    } else {
      v.pause();
      userPaused.current.add(k);
    }
    showUI(k);
  };

  /** A click (not a drag) on slot k. */
  const click = (k: number) => {
    if (items[k]?.type !== "video" || !active) return;
    if (fitted === k) togglePlay(k);
    else fitVideo(k);
  };

  /** Each time the strip moves: a centring that has arrived ends, and moving
   *  away from a fitted video puts it back. */
  const scrolled = (pos: number, arrived: boolean) => {
    const f = fit.current;
    if (!f) return;
    if (f.centring) {
      if (arrived) f.centring = false;
      return;
    }
    if (Math.abs(pos - f.pos) > UNFIT_PX) unfit();
  };

  /** Leaving the page: every video stops and goes. */
  const hideAll = () => {
    for (const v of els.current) {
      if (!v) continue;
      v.pause();
      v.style.transition = "none";
      v.style.opacity = "0";
    }
    setUiOn(false);
  };

  // Each frame while there are controls: lay them across the video's visible
  // part and move the playhead.
  React.useEffect(() => {
    if (uiFor === null) return;
    let frame = 0;
    const tick = () => {
      const v = els.current[uiFor];
      const box = vui.current;
      if (v && box) {
        const r = v.getBoundingClientRect();
        const left = Math.max(r.left + MARGIN, MARGIN);
        const right = Math.min(r.right - MARGIN, window.innerWidth - MARGIN);
        box.style.left = `${left}px`;
        box.style.width = `${Math.max(0, right - left)}px`;
        const playing = !v.paused;
        if (playButton.current) playButton.current.textContent = playing ? "Pause" : "Play";
        if (muteButton.current) muteButton.current.textContent = v.muted ? "Unmute" : "Mute";
        if (head.current) {
          head.current.className = `${styles.head} ${playing ? styles.headPlaying : styles.headStopped}`;
          head.current.style.left = `${v.duration ? (v.currentTime / v.duration) * 100 : 0}%`;
        }
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [uiFor]);

  React.useEffect(() => () => window.clearTimeout(idle.current), []);

  const seekTo = (clientX: number) => {
    if (uiFor === null) return;
    const v = els.current[uiFor];
    const t = track.current;
    if (!v || !t || !v.duration) return;
    const r = t.getBoundingClientRect();
    v.currentTime = Math.min(1, Math.max(0, (clientX - r.left) / r.width)) * v.duration;
  };

  const controls = (
    <fieldset
      ref={vui}
      data-vui
      className={`${styles.vui} ${uiOn && active ? styles.vuiOn : ""}`}
      aria-label="Video controls"
      onPointerMove={() => uiFor !== null && showUI(uiFor)}
    >
      <button type="button" ref={playButton} onClick={() => uiFor !== null && togglePlay(uiFor)}>
        Play
      </button>
      <div
        ref={track}
        className={styles.track}
        onPointerDown={(e) => {
          seeking.current = true;
          e.currentTarget.setPointerCapture(e.pointerId);
          seekTo(e.clientX);
        }}
        onPointerMove={(e) => seeking.current && seekTo(e.clientX)}
        onPointerUp={() => {
          seeking.current = false;
          if (uiFor !== null) showUI(uiFor);
        }}
      >
        <span ref={head} className={`${styles.head} ${styles.headStopped}`} />
      </div>
      <button
        type="button"
        ref={muteButton}
        onClick={() => {
          if (uiFor === null) return;
          if (uiFor !== current && fitted !== uiFor) fitVideo(uiFor);
          const v = els.current[uiFor];
          if (v) v.muted = !v.muted;
          showUI(uiFor);
        }}
      >
        Unmute
      </button>
    </fieldset>
  );

  return {
    refFor: (k: number) => (el: HTMLVideoElement | null) => {
      els.current[k] = el;
    },
    fitted,
    click,
    scrolled,
    hideAll,
    controls,
  };
}
