import * as React from "react";

/**
 * The admin in Apple's style (the owner, 7 Nov: "adopt the Apple UI Kit and
 * Human Interface Guidelines"; iOS Settings layout, light or dark with the
 * device): the pieces every page shares. The look itself is style.css.
 *
 * Icons are Google's Material Symbols, rounded, the closest openly licensed
 * set to SF Symbols, whose licence covers apps for Apple platforms only. They
 * all come through <Icon>, so another set is a change here alone.
 */
export function Icon({ name, fill, className }: { name: string; fill?: boolean; className?: string }) {
  return (
    <span className={`icon${fill ? " fill" : ""}${className ? ` ${className}` : ""}`} aria-hidden="true">
      {name}
    </span>
  );
}

// A page: the navigation bar (a back button, the title once the large title
// has scrolled under it, the page's own buttons), the large title, the
// content, and an optional toolbar along the bottom. A wide page (the preview
// cutter) has no large title: its title sits in the bar.
export function Page({
  title,
  back,
  leading,
  trailing,
  toolbar,
  wide,
  children,
}: {
  title: string;
  back?: { label: string; onClick: () => void };
  leading?: React.ReactNode;
  trailing?: React.ReactNode;
  toolbar?: React.ReactNode;
  wide?: boolean;
  children: React.ReactNode;
}) {
  const titleRef = React.useRef<HTMLHeadingElement>(null);
  const [scrolled, setScrolled] = React.useState(false);

  React.useEffect(() => {
    const el = titleRef.current;
    if (!el) return;
    // The bar's title shows once the large title has gone up under the bar.
    const observer = new IntersectionObserver(([entry]) => setScrolled(!entry.isIntersecting), {
      rootMargin: "-60px 0px 0px 0px",
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  return (
    <>
      <header className={`navbar${scrolled || wide ? " scrolled" : ""}${wide ? " wide" : ""}`}>
        <div className="navbar-side">
          {back && (
            <button type="button" className="glass back" onClick={back.onClick} aria-label={`Back to ${back.label}`}>
              <Icon name="chevron_left" />
              <span className="back-label">{back.label}</span>
            </button>
          )}
          {leading}
        </div>
        <div className="navbar-title">{title}</div>
        <div className="navbar-side end">{trailing}</div>
      </header>
      <main className={wide ? "page wide" : "page"}>
        {!wide && (
          <h1 ref={titleRef} className="large-title">
            {title}
          </h1>
        )}
        {children}
      </main>
      {toolbar && <footer className="toolbar">{toolbar}</footer>}
    </>
  );
}

// A grouped list: an optional header above it and footer below, as in
// Settings.
export function Group({
  header,
  footer,
  className,
  children,
  ...rest
}: { header?: React.ReactNode; footer?: React.ReactNode } & React.HTMLAttributes<HTMLDivElement>) {
  return (
    <section className="group">
      {header && <h2 className="group-header">{header}</h2>}
      <div className={`group-body${className ? ` ${className}` : ""}`} {...rest}>
        {children}
      </div>
      {footer && <p className="group-footer">{footer}</p>}
    </section>
  );
}

// The iOS switch.
export function Switch({
  id,
  checked,
  onChange,
  label,
}: {
  id?: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: string;
}) {
  return (
    <input
      id={id}
      type="checkbox"
      role="switch"
      aria-checked={checked}
      className="switch"
      aria-label={label}
      checked={checked}
      onChange={(e) => onChange(e.target.checked)}
    />
  );
}

// An alert, as iOS asks before something that can't be undone: a title, a
// line of explanation and its buttons. Escape or a click outside is Cancel.
export function Alert({
  title,
  message,
  confirm,
  onConfirm,
  onCancel,
}: {
  title: string;
  message: string;
  confirm: string;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  // Cancel has the focus first, so a stray Return doesn't delete anything.
  const cancelRef = React.useRef<HTMLButtonElement>(null);
  React.useEffect(() => {
    cancelRef.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onCancel();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onCancel]);
  return (
    // biome-ignore lint/a11y/useKeyWithClickEvents: Escape is handled on the window
    <div className="scrim" onClick={(e) => e.target === e.currentTarget && onCancel()}>
      <div className="alert" role="alertdialog" aria-modal="true" aria-labelledby="alert-title">
        <h2 id="alert-title" className="alert-title">
          {title}
        </h2>
        <p className="alert-message">{message}</p>
        <div className="alert-buttons">
          <button type="button" className="capsule gray" ref={cancelRef} onClick={onCancel}>
            Cancel
          </button>
          <button type="button" className="capsule destructive" onClick={onConfirm}>
            {confirm}
          </button>
        </div>
      </div>
    </div>
  );
}

// Where an item stands, as the media rows and the splash row say it: a word or
// two, with an icon while something is happening or went wrong.
export type Tone = "plain" | "busy" | "wait" | "error";
const ICONS: Record<Tone, string | null> = { plain: null, busy: "progress_activity", wait: "schedule", error: "error" };

export function State({ tone, text, why }: { tone: Tone; text: string; why?: string }) {
  const icon = ICONS[tone];
  return (
    <span className={`state tone-${tone}`} title={why}>
      {icon && <Icon name={icon} />}
      <span className="state-text">{text}</span>
    </span>
  );
}
