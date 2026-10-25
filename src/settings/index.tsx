import * as React from "react";
import {
  autoText,
  backgroundOf,
  changedKeys,
  DEFAULTS,
  getSettings,
  normalizeHex,
  resetSettings,
  type Settings,
  setSettings,
  subscribeSettings,
} from "./store";
import styles from "./style.module.css";

/**
 * The settings panel, bottom left, for trying values on the staging site:
 * the project page's arrival stagger and the site's colours (see `store.ts`).
 * Hidden until Shift+S, which shows and hides it.
 *
 * While anything differs from the site as built, a small "Custom settings"
 * marker stays in the corner with the panel hidden, so it's always clear the
 * page isn't showing the defaults. Clicking it opens the panel.
 */
export function SettingsPanel() {
  const settings = React.useSyncExternalStore(subscribeSettings, getSettings);
  const [open, setOpen] = React.useState(false);

  React.useEffect(() => {
    // Caught on the way down, before anything else hears it: the canvas moves
    // its camera on S (and on Shift+S, which reads as "S").
    const onKey = (e: KeyboardEvent) => {
      if (e.code !== "KeyS" || !e.shiftKey || e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.target instanceof HTMLInputElement && e.target.type === "text") return;
      e.preventDefault();
      e.stopPropagation();
      if (!e.repeat) setOpen((was) => !was);
    };
    window.addEventListener("keydown", onKey, { capture: true });
    return () => window.removeEventListener("keydown", onKey, { capture: true });
  }, []);

  const changed = changedKeys(settings);

  // The panel keeps its input to itself: a click mustn't stop the index's
  // slideshow, arrow keys on a slider mustn't scroll the project strip, and
  // typing a colour ("a", "d", "e") mustn't move the canvas.
  const keep = (e: React.SyntheticEvent) => e.stopPropagation();
  const own = { onClick: keep, onPointerDown: keep, onKeyDown: keep, onKeyUp: keep, onWheel: keep };

  if (!open) {
    if (!changed.length) return null;
    return (
      <button
        type="button"
        className={styles.marker}
        {...own}
        onClick={(e) => {
          keep(e);
          setOpen(true);
        }}
      >
        Custom settings
      </button>
    );
  }

  const bg = backgroundOf(settings);
  return (
    <section className={styles.panel} aria-label="Settings" {...own}>
      <header className={styles.head}>
        <span>Settings</span>
        <button type="button" className={styles.link} onClick={() => setOpen(false)}>
          Hide
        </button>
      </header>

      <h3 className={styles.group}>Project page arrival</h3>
      <Slider
        label="Gap between images"
        name="riseGapMs"
        settings={settings}
        min={0}
        max={200}
        step={5}
        format={(ms) => `${ms}ms`}
      />
      <Slider
        label="Longest wave"
        name="riseWaveMaxMs"
        settings={settings}
        min={0}
        max={5000}
        step={100}
        format={(ms) => `${(ms / 1000).toFixed(1)}s`}
      />
      <p className={styles.note}>The images rise this far apart, squeezed into the longest wave. Used the next time a project opens.</p>

      <h3 className={styles.group}>Colours</h3>
      <Colour label="Background" name="background" settings={settings} shown={bg} />
      <Colour label="Text" name="text" settings={settings} shown={settings.text ?? autoText(bg)} placeholder="auto" />

      <footer className={styles.foot}>
        <span className={styles.note}>{changed.length ? "Saved in this browser" : "Showing the site as built"}</span>
        <button type="button" className={styles.link} onClick={resetSettings} disabled={!changed.length}>
          Reset all
        </button>
      </footer>
      <p className={styles.note}>Shift+S shows and hides this panel</p>
    </section>
  );
}

/** A row's reset, shown only while it differs from the site as built. */
function Reset({ name, settings }: { name: keyof Settings; settings: Settings }) {
  if (settings[name] === DEFAULTS[name]) return <span className={styles.reset} />;
  return (
    <button type="button" className={`${styles.link} ${styles.reset}`} onClick={() => setSettings({ [name]: DEFAULTS[name] })}>
      Reset
    </button>
  );
}

function Slider({
  label,
  name,
  settings,
  min,
  max,
  step,
  format,
}: {
  label: string;
  name: "riseGapMs" | "riseWaveMaxMs";
  settings: Settings;
  min: number;
  max: number;
  step: number;
  format: (value: number) => string;
}) {
  const value = settings[name];
  const changed = value !== DEFAULTS[name];
  return (
    <label className={styles.row}>
      <span className={styles.label}>{label}</span>
      <input
        type="range"
        className={styles.slider}
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => setSettings({ [name]: Number(e.currentTarget.value) })}
      />
      <span className={`${styles.value} ${changed ? styles.changed : ""}`}>{format(value)}</span>
      <Reset name={name} settings={settings} />
    </label>
  );
}

/**
 * A colour: a swatch that opens the system picker, and the hex beside it to
 * type into. Typing applies as soon as it's a colour; leaving the field empty
 * goes back to the site's own.
 */
function Colour({
  label,
  name,
  settings,
  shown,
  placeholder,
}: {
  label: string;
  name: "background" | "text";
  settings: Settings;
  shown: string;
  placeholder?: string;
}) {
  const value = settings[name];
  const [draft, setDraft] = React.useState<string | null>(null);
  return (
    <div className={styles.row}>
      <span className={styles.label}>{label}</span>
      <input
        type="color"
        className={styles.swatch}
        aria-label={`${label} colour`}
        value={shown}
        onChange={(e) => setSettings({ [name]: e.currentTarget.value })}
      />
      <input
        type="text"
        className={`${styles.hex} ${value ? styles.changed : ""}`}
        aria-label={`${label} hex`}
        spellCheck={false}
        placeholder={placeholder ?? shown}
        value={draft ?? value ?? ""}
        onFocus={() => setDraft(value ?? "")}
        onChange={(e) => {
          const typed = e.currentTarget.value;
          setDraft(typed);
          const hex = normalizeHex(typed);
          if (hex) setSettings({ [name]: hex });
          else if (!typed.trim()) setSettings({ [name]: null });
        }}
        onBlur={() => setDraft(null)}
        onKeyDown={(e) => {
          if (e.key === "Enter") e.currentTarget.blur();
        }}
      />
      <Reset name={name} settings={settings} />
    </div>
  );
}
