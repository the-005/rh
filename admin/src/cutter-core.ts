/**
 * The Preview Cutter's engine, brought over from the Preview Cutter artifact
 * (v2, 2 Nov) into the admin: one video at a time, streamed from storage.
 *
 * It finds the video's cuts by comparing small frames, suggests two pieces
 * that start on cuts (both by the rules in admin/pieces.ts, shared with the
 * automatic previews), and lets them be moved and trimmed on a filmstrip
 * (handles snap to cuts; Alt places them freely), up to 10 seconds in all.
 * The loop plays with two video elements taking turns, so each join lands on
 * the next piece's first frame. Saving hands the pieces back; the preview
 * itself is made in the cloud from the original (scripts/process-media.ts).
 *
 * Imperative on purpose, as the artifact was: the strip, the pieces and the
 * playhead redraw on every pointer move, outside React.
 */

import { ALL_FORMATS, CanvasSink, Input, type InputVideoTrack, UrlSource } from "mediabunny";
import { cutDetector, shots as shotsOf, suggestPieces } from "../pieces.ts";
import { PIECE_MIN, PREVIEW_MAX, type Piece } from "../shared.ts";

const NEW_PIECE = 2; // length of a piece added with "Add piece", s
const SNAP_PX = 10; // a handle this close to a cut lands on it
const HANDLE = 10; // handle width, px (matches .piece border)
const MIN_VIEW = 2; // closest zoom: this many seconds across the strip

export type CutterElements = {
  root: HTMLElement;
  stage: HTMLElement;
  videoA: HTMLVideoElement;
  videoB: HTMLVideoElement;
  playButton: HTMLButtonElement;
  playIcon: SVGPathElement;
  track: HTMLElement;
  strip: HTMLCanvasElement;
  ticks: HTMLElement;
  pieces: HTMLElement;
  playhead: HTMLElement;
  tip: HTMLElement;
  readout: HTMLElement;
  hint: HTMLElement;
  addButton: HTMLButtonElement;
  saveButton: HTMLButtonElement;
};

export type CutterOptions = {
  elements: CutterElements;
  url: string;
  // Cuts found before (instant reopening), and the pieces last saved.
  cuts?: number[];
  pieces?: Piece[];
  status: (text: string) => void;
  foundCuts: (cuts: number[]) => void;
  save: (pieces: Piece[]) => Promise<void>;
};

const PLAY_PATH = "M4 2.5v13l11-6.5z";
const PAUSE_PATH = "M4 2.5h3.5v13H4zM10.5 2.5H14v13h-3.5z";
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

type Video = {
  input: Input;
  track: InputVideoTrack;
  duration: number;
  fps: number;
  w: number;
  h: number;
  cuts: number[];
  scanned: boolean;
  thumbs: { t: number; c: CanvasImageSource & { width: number; height: number } }[];
  sel: number;
  pieces: Piece[];
};

export function mountCutter(o: CutterOptions) {
  const el = o.elements;
  let cur: Video | null = null;
  let alive = true;
  let playing = false;
  let act = el.videoA;
  let standby = el.videoB;
  let pi = 0; // index of the piece playing
  let playT = 0; // playhead, source seconds
  let view = { a: 0, b: 1 }; // the stretch of the video the strip shows, s
  const disposers: (() => void)[] = [];
  const on = <K extends keyof WindowEventMap>(target: Window, type: K, fn: (e: WindowEventMap[K]) => void) => {
    target.addEventListener(type, fn);
    disposers.push(() => target.removeEventListener(type, fn));
  };
  const setStatus = o.status;
  const buttons = () => [el.playButton, el.addButton, el.saveButton];

  /* ---------- Opening ---------- */

  async function open() {
    setStatus("Opening");
    try {
      const input = new Input({ formats: ALL_FORMATS, source: new UrlSource(o.url) });
      const track = await input.getPrimaryVideoTrack();
      if (!track) throw new Error("This file has no video track.");
      if (!(await track.canDecode()))
        throw new Error(`This browser can't read ${track.codec ?? "this"} video. It opens once it's compressed.`);
      const duration = await input.computeDuration();
      const stats = await track.computePacketStats(120);
      if (!alive) return;
      cur = {
        input,
        track,
        duration,
        fps: stats.averagePacketRate || 30,
        w: track.displayWidth,
        h: track.displayHeight,
        cuts: o.cuts ? [...o.cuts] : [],
        scanned: false,
        thumbs: [],
        sel: -1,
        pieces: [],
      };
      el.videoA.src = o.url;
      el.videoB.src = o.url;
      view = { a: 0, b: duration };
      playT = 0;
      render();
      makeThumbs();
      if (o.cuts) ready();
      else findCuts();
    } catch (error) {
      if (!alive) return;
      setStatus(error instanceof Error ? error.message : "Couldn't open this video");
      for (const b of buttons()) b.disabled = true;
    }
  }

  // Once the cuts are known: the pieces this video opens with, and editing turns on.
  function ready() {
    if (!cur) return;
    cur.scanned = true;
    const n = cur.cuts.length;
    setStatus(n ? `${n} ${n === 1 ? "cut" : "cuts"} in this video` : "No cuts in this video");
    cur.pieces = o.pieces?.length ? o.pieces.map((p) => ({ ...p })) : suggestPieces(cur.cuts, cur.duration);
    el.playButton.disabled = false;
    el.saveButton.disabled = false;
    render();
    showFrame(cur.pieces[0]?.s ?? 0);
  }

  // The shots long enough to hold a piece (the rules are shared with the
  // automatic previews: admin/pieces.ts).
  const shots = () => (cur ? shotsOf(cur.cuts, cur.duration) : []);
  const strict = () => (cur?.cuts.length ?? 0) > 0;

  /* ---------- Filmstrip ---------- */

  let thumbRun = 0;
  async function makeThumbs() {
    if (!cur) return;
    const video = cur;
    const run = ++thumbRun;
    const dpr = window.devicePixelRatio || 1;
    const sink = new CanvasSink(video.track, { height: Math.round(el.track.clientHeight * dpr) });
    const times = cellTimes().filter((t) => !video.thumbs.some((th) => Math.abs(th.t - t) < 0.02));
    for await (const wc of sink.canvasesAtTimestamps(times)) {
      if (!alive || run !== thumbRun) return;
      if (wc) video.thumbs.push({ t: wc.timestamp, c: wc.canvas });
      if (video.thumbs.length > 400) video.thumbs.shift();
      drawStrip();
    }
  }
  let thumbTimer = 0;
  const thumbsSoon = () => {
    window.clearTimeout(thumbTimer);
    thumbTimer = window.setTimeout(() => alive && makeThumbs(), 180);
  };

  function cellTimes() {
    if (!cur) return [];
    const video = cur;
    const W = trackW();
    const cellW = el.track.clientHeight * (video.w / video.h);
    const n = Math.max(1, Math.ceil(W / cellW));
    return Array.from({ length: n }, (_, i) => clamp(view.a + ((i + 0.5) * cellW * span()) / W, 0, video.duration - 0.01));
  }

  function drawStrip() {
    const c = el.strip;
    const dpr = window.devicePixelRatio || 1;
    c.width = Math.round(c.clientWidth * dpr);
    c.height = Math.round(c.clientHeight * dpr);
    const ctx = c.getContext("2d");
    if (!ctx) return;
    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, c.width, c.height);
    if (!cur || !cur.thumbs.length) return;
    const video = cur;
    const cw = c.height * (video.w / video.h);
    cellTimes().forEach((t, i) => {
      let best = video.thumbs[0];
      for (const th of video.thumbs) if (Math.abs(th.t - t) < Math.abs(best.t - t)) best = th;
      const img = best.c;
      const scale = Math.max(cw / img.width, c.height / img.height);
      const sw = cw / scale;
      const sh = c.height / scale;
      ctx.drawImage(img, (img.width - sw) / 2, (img.height - sh) / 2, sw, sh, Math.floor(i * cw), 0, Math.ceil(cw), c.height);
    });
  }

  /* ---------- Finding cuts ---------- */

  async function findCuts() {
    if (!cur) return;
    const video = cur;
    const W = 64;
    const H = 36;
    const sink = new CanvasSink(video.track, { width: W, height: H, fit: "fill", poolSize: 2 });
    const small = document.createElement("canvas");
    small.width = W;
    small.height = H;
    const sctx = small.getContext("2d", { willReadFrequently: true });
    if (!sctx) return;
    const detect = cutDetector(video.fps);
    let frame = 0;
    for await (const wc of sink.canvases()) {
      if (!alive) return;
      sctx.drawImage(wc.canvas, 0, 0);
      const d = sctx.getImageData(0, 0, W, H).data;
      const y = new Float32Array(W * H);
      for (let i = 0; i < y.length; i++) y[i] = 0.299 * d[i * 4] + 0.587 * d[i * 4 + 1] + 0.114 * d[i * 4 + 2];
      const cut = detect(y, wc.timestamp);
      if (cut !== null) {
        video.cuts.push(cut);
        renderTicks();
      }
      if (++frame % 15 === 0) setStatus(`Finding cuts ${Math.round((wc.timestamp / video.duration) * 100)}%`);
    }
    if (!alive) return;
    o.foundCuts(video.cuts);
    ready();
  }

  /* ---------- Drawing the bar ---------- */

  const trackW = () => el.track.clientWidth;
  const span = () => view.b - view.a;
  const xOf = (t: number) => ((t - view.a) / span()) * trackW();
  const tAt = (clientX: number) => {
    const r = el.track.getBoundingClientRect();
    return view.a + clamp((clientX - r.left) / r.width, 0, 1) * span();
  };

  // Vertical scroll or pinch zooms around the pointer; sideways scroll pans.
  const onWheel = (e: WheelEvent) => {
    if (!cur) return;
    e.preventDefault();
    const r = el.track.getBoundingClientRect();
    const f = clamp((e.clientX - r.left) / r.width, 0, 1);
    const sideways = e.shiftKey || Math.abs(e.deltaX) > Math.abs(e.deltaY);
    let a: number;
    let len: number;
    if (sideways && !e.ctrlKey) {
      len = span();
      a = view.a + ((e.shiftKey ? e.deltaY : e.deltaX) / r.width) * len;
    } else {
      const at = view.a + f * span();
      len = clamp(span() * Math.exp(e.deltaY * (e.ctrlKey ? 0.01 : 0.002)), Math.min(MIN_VIEW, cur.duration), cur.duration);
      a = at - f * len;
    }
    a = clamp(a, 0, cur.duration - len);
    view = { a, b: a + len };
    render();
    thumbsSoon();
  };
  el.track.addEventListener("wheel", onWheel, { passive: false });
  disposers.push(() => el.track.removeEventListener("wheel", onWheel));

  function render() {
    drawStrip();
    renderPieces();
    renderTicks();
    renderReadout();
    setPlayhead(playT);
  }

  function renderPieces() {
    el.pieces.replaceChildren();
    if (!cur) return;
    const video = cur;
    let last = 0;
    const gap = (a: number, b: number) => {
      if (b - a <= 0) return;
      const g = document.createElement("div");
      g.className = "gap";
      g.style.left = `${xOf(a)}px`;
      g.style.width = `${xOf(b) - xOf(a)}px`;
      el.pieces.append(g);
    };
    video.pieces.forEach((p, i) => {
      gap(last, p.s);
      const d = document.createElement("div");
      d.className = `piece${i === video.sel ? " sel" : ""}`;
      d.dataset.i = String(i);
      d.style.left = `${xOf(p.s) - HANDLE}px`;
      d.style.width = `${xOf(p.e) - xOf(p.s) + HANDLE * 2}px`;
      const left = document.createElement("span");
      left.className = "h l";
      left.dataset.edge = "s";
      const right = document.createElement("span");
      right.className = "h r";
      right.dataset.edge = "e";
      const del = document.createElement("button");
      del.className = "del";
      del.type = "button";
      del.setAttribute("aria-label", "Remove piece");
      del.textContent = "×";
      d.append(left, right, del);
      el.pieces.append(d);
      last = p.e;
    });
    gap(last, video.duration);
  }

  function renderTicks(hot: number | null = null) {
    el.ticks.replaceChildren();
    if (!cur) return;
    for (const c of cur.cuts) {
      const t = document.createElement("div");
      t.className = `tick${hot !== null && Math.abs(c - hot) < 1e-6 ? " hot" : ""}`;
      t.style.left = `${xOf(c)}px`;
      el.ticks.append(t);
    }
  }

  const total = () => (cur ? cur.pieces.reduce((a, p) => a + (p.e - p.s), 0) : 0);
  const isCut = (t: number) => !!cur && cur.cuts.some((c) => Math.abs(c - t) < 0.6 / (cur as Video).fps);

  // Cuts the loop shows: each join between pieces (the restart included), plus the video's own cuts inside a piece.
  function loopCuts() {
    if (!cur) return 0;
    const ps = cur.pieces;
    let joins = 0;
    ps.forEach((p, i) => {
      const next = ps[(i + 1) % ps.length];
      const continuous = Math.abs(p.e - next.s) < 1e-3 && !isCut(p.e);
      if (!continuous) joins++;
    });
    const inside = cur.cuts.filter((c) => ps.some((p) => c > p.s + 1e-3 && c < p.e - 1e-3)).length;
    return joins + inside;
  }

  function renderReadout() {
    if (!cur) return;
    if (!cur.scanned) {
      el.readout.textContent = "Finding the cuts first";
      el.hint.textContent = "Pieces are placed once the whole video has been checked.";
      for (const b of buttons()) b.disabled = true;
      return;
    }
    el.hint.textContent = strict()
      ? "Handles snap to cuts; hold Alt to place them freely. Scroll or pinch the strip to zoom."
      : "No cuts in this video. Scroll or pinch the strip to zoom.";
    const k = loopCuts();
    el.readout.innerHTML = `<b>${total().toFixed(1)}</b> / ${PREVIEW_MAX} s · <span class="${k < 2 ? "low" : ""}">${k} ${k === 1 ? "cut" : "cuts"}</span>`;
    el.addButton.disabled = !newPiece();
    el.saveButton.disabled = !cur.pieces.length;
  }

  function setPlayhead(t: number) {
    playT = t;
    if (!cur) return;
    el.playhead.style.display = "block";
    el.playhead.style.left = `${xOf(t)}px`;
  }

  function showTip(t: number, snapped: boolean) {
    el.tip.style.display = "block";
    el.tip.style.left = `${HANDLE + xOf(t)}px`;
    el.tip.className = `tip${snapped ? " cut" : ""}`;
    el.tip.textContent = `${t.toFixed(2)} s${snapped ? " · on a cut" : ""}`;
  }
  const hideTip = () => {
    el.tip.style.display = "none";
  };

  /* ---------- Editing pieces ---------- */

  // The nearest cut (or the video's start or end) within SNAP_PX of t.
  function snap(t: number, free: boolean) {
    if (free || !cur) return { t, cut: null as number | null };
    const px = SNAP_PX * (span() / trackW());
    let best: number | null = null;
    for (const c of [0, cur.duration, ...cur.cuts]) {
      if (Math.abs(c - t) <= px && (best === null || Math.abs(c - t) < Math.abs(best - t))) best = c;
    }
    return best === null ? { t, cut: null } : { t: best, cut: best };
  }

  // Where "Add piece" would put a piece: nearest the playhead, in free room, under the 10 s cap.
  function newPiece(): Piece | null {
    if (!cur) return null;
    const video = cur;
    const room = PREVIEW_MAX - total();
    if (room < PIECE_MIN) return null;
    const nextStart = (t: number) => video.pieces.find((p) => p.s >= t - 1e-6)?.s ?? video.duration;
    const free = (t: number) => !video.pieces.some((p) => t < p.e - 1e-6 && t + PIECE_MIN > p.s + 1e-6);
    if (strict()) {
      const cands = shots().filter((sh) => free(sh.s) && Math.min(sh.e, nextStart(sh.s + 1e-6)) - sh.s >= PIECE_MIN);
      if (!cands.length) return null;
      const sh = cands.sort((x, y) => Math.abs(x.s - playT) - Math.abs(y.s - playT))[0];
      return { s: sh.s, e: sh.s + Math.min(NEW_PIECE, room, sh.e - sh.s, nextStart(sh.s + 1e-6) - sh.s) };
    }
    const gaps: [number, number][] = [];
    let last = 0;
    for (const p of video.pieces) {
      gaps.push([last, p.s]);
      last = p.e;
    }
    gaps.push([last, video.duration]);
    const fits = gaps.filter(([g0, g1]) => g1 - g0 >= PIECE_MIN);
    if (!fits.length) return null;
    const at = fits.find(([g0, g1]) => playT >= g0 && playT < g1) ?? fits.reduce((m, g) => (g[1] - g[0] > m[1] - m[0] ? g : m));
    const l = Math.min(NEW_PIECE, room, at[1] - at[0]);
    const st = clamp(playT, at[0], at[1] - l);
    return { s: st, e: st + l };
  }

  function addPiece() {
    const p = newPiece();
    if (!p || !cur) return;
    cur.pieces.push(p);
    cur.pieces.sort((x, y) => x.s - y.s);
    cur.sel = cur.pieces.indexOf(p);
    edited();
    showFrame(p.s);
  }

  function removePiece(i: number) {
    if (!cur) return;
    cur.pieces.splice(i, 1);
    cur.sel = -1;
    edited();
  }

  function edited() {
    if (!cur) return;
    renderPieces();
    renderReadout();
    if (playing) {
      if (!cur.pieces.length) return pause();
      pi = Math.min(pi, cur.pieces.length - 1);
      primeStandby();
    }
  }

  type Drag =
    | { kind: "scrub" }
    | { kind: "s"; i: number }
    | { kind: "e"; i: number }
    | { kind: "move"; i: number; offset: number };
  let drag: Drag | null = null;

  const onDown = (e: PointerEvent) => {
    if (!cur || e.button !== 0) return;
    const target = e.target as HTMLElement;
    const pieceEl = cur.scanned ? (target.closest(".piece") as HTMLElement | null) : null;
    const i = pieceEl ? Number(pieceEl.dataset.i) : -1;
    if (target.closest(".del")) {
      removePiece(i);
      return;
    }
    e.preventDefault();
    const t = tAt(e.clientX);
    const edge = (target.closest(".h") as HTMLElement | null)?.dataset.edge as "s" | "e" | undefined;
    if (i >= 0) {
      const p = cur.pieces[i];
      cur.sel = i;
      drag = edge ? { kind: edge, i } : { kind: "move", i, offset: t - p.s };
      renderPieces();
    } else {
      cur.sel = -1;
      renderPieces();
      drag = { kind: "scrub" };
      showFrame(t);
    }
    pause();
    el.root.classList.add("dragging");
  };
  el.track.addEventListener("pointerdown", onDown);
  disposers.push(() => el.track.removeEventListener("pointerdown", onDown));

  on(window, "pointermove", (e) => {
    if (!drag || !cur) return;
    const d = drag;
    const video = cur;
    const t = tAt(e.clientX);
    if (d.kind === "scrub") {
      showFrame(t);
      return;
    }
    const ps = video.pieces;
    const p = ps[d.i];
    const before = d.i > 0 ? ps[d.i - 1].e : 0;
    const after = d.i < ps.length - 1 ? ps[d.i + 1].s : video.duration;
    const room = PREVIEW_MAX - (total() - (p.e - p.s)); // longest this piece may be
    let cut: number | null = null;

    if (d.kind === "s") {
      const sn = snap(t, e.altKey);
      const s = clamp(sn.t, Math.max(before, p.e - room), p.e - PIECE_MIN);
      cut = sn.cut !== null && Math.abs(s - sn.cut) < 1e-6 ? sn.cut : null;
      p.s = s;
      showFrame(s);
      showTip(s, cut !== null);
    } else if (d.kind === "e") {
      const sn = snap(t, e.altKey);
      const end = clamp(sn.t, p.s + PIECE_MIN, Math.min(after, p.s + room));
      cut = sn.cut !== null && Math.abs(end - sn.cut) < 1e-6 ? sn.cut : null;
      p.e = end;
      showFrame(Math.max(p.s, end - 1 / video.fps)); // the piece's last frame
      showTip(end, cut !== null);
    } else {
      const len = p.e - p.s;
      let s = t - d.offset;
      if (!e.altKey) {
        const a = snap(s, false);
        const b = snap(s + len, false);
        const da = a.cut === null ? Number.POSITIVE_INFINITY : Math.abs(a.t - s);
        const db = b.cut === null ? Number.POSITIVE_INFINITY : Math.abs(b.t - (s + len));
        if (da <= db && Number.isFinite(da)) {
          s = a.t;
          cut = a.cut;
        } else if (Number.isFinite(db)) {
          s = b.t - len;
          cut = b.cut;
        }
      }
      const clamped = clamp(s, before, after - len);
      if (Math.abs(clamped - s) > 1e-6) cut = null;
      p.s = clamped;
      p.e = clamped + len;
      showFrame(p.s);
      showTip(p.s, cut !== null);
    }
    renderPieces();
    renderTicks(cut);
    renderReadout();
  });

  on(window, "pointerup", () => {
    if (!drag) return;
    drag = null;
    el.root.classList.remove("dragging");
    hideTip();
    renderTicks();
    edited();
  });

  /* ---------- Showing frames and playing the loop ---------- */

  let pendingSeek: number | null = null;
  function showFrame(t: number) {
    setPlayhead(t);
    pendingSeek = t;
    if (!act.seeking) flushSeek();
  }
  function flushSeek() {
    if (pendingSeek === null) return;
    act.currentTime = pendingSeek;
    pendingSeek = null;
  }
  for (const v of [el.videoA, el.videoB]) {
    const onSeeked = () => v === act && flushSeek();
    v.addEventListener("seeked", onSeeked);
    disposers.push(() => v.removeEventListener("seeked", onSeeked));
  }

  function setPlayIcon() {
    el.playIcon.setAttribute("d", playing ? PAUSE_PATH : PLAY_PATH);
    el.playButton.setAttribute("aria-label", playing ? "Pause" : "Play preview");
  }

  // Two video elements take turns, so each cut lands on the next piece's first frame without waiting for a seek.
  function play() {
    if (!cur || !cur.pieces.length || playing) return;
    const video = cur;
    playing = true;
    setPlayIcon();
    const inside = video.pieces.findIndex((p) => playT >= p.s && playT < p.e - 0.5 / video.fps);
    pi =
      inside >= 0
        ? inside
        : Math.max(
            0,
            video.pieces.findIndex((p) => p.s >= playT)
          );
    if (inside < 0) act.currentTime = video.pieces[pi].s;
    primeStandby();
    act.play().catch(() => pause());
    watch(act);
  }

  function pause() {
    if (!playing) return;
    playing = false;
    setPlayIcon();
    act.pause();
    standby.pause();
  }

  function primeStandby() {
    if (!cur) return;
    const next = cur.pieces[(pi + 1) % cur.pieces.length];
    standby.pause();
    standby.currentTime = next.s;
  }

  function watch(v: HTMLVideoElement) {
    const onFrame: VideoFrameRequestCallback = (_now, meta) => {
      if (!playing || v !== act || !cur) return;
      const p = cur.pieces[pi];
      setPlayhead(meta.mediaTime);
      if (!p || meta.mediaTime + 1 / cur.fps > p.e - 1e-3) {
        swap();
        return;
      }
      v.requestVideoFrameCallback(onFrame);
    };
    v.requestVideoFrameCallback(onFrame);
  }

  function swap() {
    if (!cur) return;
    pi = (pi + 1) % cur.pieces.length;
    const next = standby;
    const prev = act;
    if (Math.abs(next.currentTime - cur.pieces[pi].s) > 0.02) next.currentTime = cur.pieces[pi].s;
    next.play().catch(() => pause());
    next.classList.add("on");
    prev.classList.remove("on");
    prev.pause();
    act = next;
    standby = prev;
    primeStandby();
    watch(act);
  }

  const onPlay = () => (playing ? pause() : play());
  el.playButton.addEventListener("click", onPlay);
  el.addButton.addEventListener("click", addPiece);
  const onSave = async () => {
    if (!cur || !cur.pieces.length) return;
    pause();
    for (const b of buttons()) b.disabled = true;
    try {
      await o.save(cur.pieces.map((p) => ({ ...p })));
    } finally {
      el.playButton.disabled = false;
      renderReadout();
    }
  };
  el.saveButton.addEventListener("click", onSave);
  disposers.push(() => {
    el.playButton.removeEventListener("click", onPlay);
    el.addButton.removeEventListener("click", addPiece);
    el.saveButton.removeEventListener("click", onSave);
  });

  on(window, "keydown", (e) => {
    if ((e.target as HTMLElement | null)?.closest?.("input, md-outlined-text-field")) return;
    if (!cur) return;
    if (e.key === " ") {
      e.preventDefault();
      if (playing) pause();
      else play();
    }
    if ((e.key === "Backspace" || e.key === "Delete") && cur.sel >= 0) {
      e.preventDefault();
      removePiece(cur.sel);
    }
  });

  const resize = new ResizeObserver(() => {
    if (cur) {
      render();
      thumbsSoon();
    }
  });
  resize.observe(el.track);
  disposers.push(() => resize.disconnect());

  for (const b of buttons()) b.disabled = true;
  open();

  return () => {
    alive = false;
    pause();
    window.clearTimeout(thumbTimer);
    for (const dispose of disposers) dispose();
    cur?.input.dispose();
    el.videoA.removeAttribute("src");
    el.videoB.removeAttribute("src");
  };
}
