/**
 * Settings for trying values on the staging site without a deploy (the
 * "settings for Ruben" ticket): the project page's arrival stagger, and the
 * site's background and text colours.
 *
 * Kept in this browser's localStorage, so they survive a reload and apply on
 * every page. The colours go onto :root as CSS variables, which the stylesheets
 * read with the site's own values as fallbacks: with nothing set, nothing is
 * set, and the site is exactly as built.
 */

/**
 * The project page's rise is a wave, left to right: RISE_GAP_MS between
 * images, squeezed evenly into RISE_WAVE_MAX_MS when that would run longer (the
 * owner's "capped" pick in the Strip Flip bench). Only big projects change:
 * PR-01's 52 would have taken 3.6s at the old 70ms and now take 1.5s.
 */
export const RISE_GAP_MS = 50;
export const RISE_WAVE_MAX_MS = 1500;

export type Settings = {
  riseGapMs: number;
  riseWaveMaxMs: number;
  /** A hex colour, or null for the site's white. */
  background: string | null;
  /** A hex colour for text as it reads on the background, or null for the site's own. */
  text: string | null;
};

export const DEFAULTS: Settings = { riseGapMs: RISE_GAP_MS, riseWaveMaxMs: RISE_WAVE_MAX_MS, background: null, text: null };

const STORAGE_KEY = "rh:settings";
const WHITE = "#ffffff";

/** `#rgb` or `#rrggbb`, as `#rrggbb` in lower case; null for anything else. */
export function normalizeHex(value: string): string | null {
  const m = value.trim().match(/^#?([0-9a-f]{3}|[0-9a-f]{6})$/i);
  if (!m) return null;
  const digits = m[1].length === 3 ? [...m[1]].map((d) => d + d).join("") : m[1];
  return `#${digits.toLowerCase()}`;
}

const channels = (hex: string) => [1, 3, 5].map((i) => Number.parseInt(hex.slice(i, i + 2), 16));
const toHex = (rgb: number[]) => `#${rgb.map((c) => Math.round(c).toString(16).padStart(2, "0")).join("")}`;

/**
 * The site's own text is drawn light and blended by difference (#eee for the
 * index, white for the frame), so on a background B it reads as |B − #eee|:
 * dark on white, light on black. That is what "auto" text means.
 */
export function autoText(background: string): string {
  return toHex(channels(background).map((b) => Math.abs(b - 238)));
}

/**
 * The colour to draw text in so that, blended by difference over `background`,
 * it reads as `text`: per channel, background − text, or background + text when
 * the text is the lighter of the two. Exact except where a light text on a
 * mid background would need more than white.
 */
function inkFor(background: string, text: string): string {
  const b = channels(background);
  return toHex(channels(text).map((t, i) => (t <= b[i] ? b[i] - t : Math.min(255, b[i] + t))));
}

function load(): Settings {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "null");
    if (!saved || typeof saved !== "object") return DEFAULTS;
    const num = (v: unknown, fallback: number) => (typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : fallback);
    const hex = (v: unknown) => (typeof v === "string" ? normalizeHex(v) : null);
    return {
      riseGapMs: num(saved.riseGapMs, RISE_GAP_MS),
      riseWaveMaxMs: num(saved.riseWaveMaxMs, RISE_WAVE_MAX_MS),
      background: hex(saved.background),
      text: hex(saved.text),
    };
  } catch {
    return DEFAULTS;
  }
}

let current = load();
const listeners = new Set<() => void>();

export const getSettings = () => current;

export function subscribeSettings(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Which settings differ from the site as built. */
export function changedKeys(settings: Settings = current): (keyof Settings)[] {
  return (Object.keys(DEFAULTS) as (keyof Settings)[]).filter((key) => settings[key] !== DEFAULTS[key]);
}

/** The background in use, the site's white included. */
export const backgroundOf = (settings: Settings) => settings.background ?? WHITE;

export function setSettings(patch: Partial<Settings>) {
  current = { ...current, ...patch };
  try {
    if (changedKeys().length) localStorage.setItem(STORAGE_KEY, JSON.stringify(current));
    else localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Storage blocked (a private window): the settings still apply until a reload.
  }
  applyColours();
  for (const listener of listeners) listener();
}

export const resetSettings = () => setSettings(DEFAULTS);

/**
 * --site-bg: the background, wherever the site was white. --site-text: text
 * drawn plainly (not blended), such as the research slider's thumb, which
 * follows the background when no text colour is set. --ink: blended text,
 * only when a text colour is set.
 */
function applyColours() {
  const root = document.documentElement.style;
  const put = (name: string, value: string | null) => (value ? root.setProperty(name, value) : root.removeProperty(name));
  const { background, text } = current;
  const bg = background ?? WHITE;
  put("--site-bg", background);
  put("--site-text", text ?? (background ? autoText(bg) : null));
  put("--ink", text ? inkFor(bg, text) : null);
}

applyColours();
