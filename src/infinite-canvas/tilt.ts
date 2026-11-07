/**
 * Turning the phone leans the gallery's camera (the owner, 8 Nov: "on mobile,
 * using the gyroscope to create a spatial effect"). A laptop leans it toward
 * the cursor (PARALLAX_AMOUNT); a phone has no cursor, so the phone itself
 * stands in for it, as if the screen were a window onto the gallery: turn it
 * and the near images slide across the far ones.
 *
 * Read from the gyroscope's rotation rate, added up into an angle that eases
 * back to nothing over TILT_SETTLE_MS: whatever angle the phone is held at
 * becomes straight ahead, so it works lying down as well as standing, and
 * only turning it leans the view.
 *
 * On an iPhone, Safari gives a page no motion until the person allows it, in
 * a system prompt that can only be asked for from a touch (there's no way
 * around it): askTilt() asks once, at the end of the first swipe, never as the
 * page opens or on a tap that opens a project. Turned down, the gallery stays
 * as it was. Android doesn't ask.
 */

/** Turning the phone this many degrees leans the camera all the way, as far as
 *  a cursor at the screen's edge does on a laptop. */
const TILT_FULL_DEG = 10;
/** The angle the phone is turned to eases back to nothing over about this long,
 *  so the way it's held becomes straight ahead. */
const TILT_SETTLE_MS = 2500;

type MotionPermission = { requestPermission?: () => Promise<"granted" | "denied"> };

// The phone's turn since it settled, in degrees, along its own x (right) and y (up).
const turned = { x: 0, y: 0 };
let lastAt = 0;
let listening = false;
// Motion has arrived, so there's nothing to ask for (Android, or an iPhone once allowed).
let heard = false;
let asking = false;
let answered = false;

const askNeeded = () =>
  typeof DeviceMotionEvent !== "undefined" &&
  typeof (DeviceMotionEvent as unknown as MotionPermission).requestPermission === "function";

const calm = () => typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;

const onMotion = (e: DeviceMotionEvent) => {
  const rate = e.rotationRate;
  if (!rate || rate.beta == null || rate.gamma == null) return;
  heard = true;
  const now = performance.now();
  const dt = lastAt ? Math.min(100, now - lastAt) : 16;
  lastAt = now;
  const settle = Math.exp(-dt / TILT_SETTLE_MS);
  // Seen through a window you turn: turning it to face right (about its
  // vertical axis, gamma) puts your eye to its left; tipping its top toward you
  // (about its horizontal axis, beta) puts your eye toward its top.
  turned.x = (turned.x - (rate.gamma * dt) / 1000) * settle;
  turned.y = (turned.y + (rate.beta * dt) / 1000) * settle;
};

// Back from another app or tab, the phone may be held differently: start straight.
const onVisibility = () => {
  turned.x = 0;
  turned.y = 0;
  lastAt = 0;
};

const listen = () => {
  if (listening) return;
  listening = true;
  window.addEventListener("devicemotion", onMotion);
  document.addEventListener("visibilitychange", onVisibility);
};

/** On a touch screen, as the gallery opens: listens straight away. Motion
 *  arrives at once wherever no permission is needed (Android); an iPhone sends
 *  none until it's allowed. */
export function startTilt() {
  if (calm() || typeof DeviceMotionEvent === "undefined") return;
  listen();
}

/** From the end of a swipe: if no motion has arrived yet, asks for it once
 *  (an iPhone's prompt needs a touch to come from; Chrome has the same call and
 *  answers without one). Asked again on the next swipe only if Safari didn't
 *  count this one as a touch. */
export function askTilt() {
  if (heard || asking || answered || !listening || !askNeeded()) return;
  asking = true;
  (DeviceMotionEvent as unknown as Required<MotionPermission>)
    .requestPermission()
    .then((answer) => {
      answered = true;
      if (answer !== "granted") return;
      // Listen afresh, so Safari starts sending motion to it.
      window.removeEventListener("devicemotion", onMotion);
      window.addEventListener("devicemotion", onMotion);
    })
    .catch(() => {})
    .finally(() => {
      asking = false;
    });
}

/** How far the phone asks the camera to lean, -1 to 1 across the screen (x,
 *  right) and up it (y), as the cursor's position does on a laptop. */
export function readTilt() {
  const angle = (screen.orientation?.angle ?? Number((window as { orientation?: number }).orientation ?? 0)) || 0;
  const a = (angle * Math.PI) / 180;
  // The phone's own axes turned to the screen's: held sideways, its top is the screen's left or right.
  const x = turned.x * Math.cos(a) - turned.y * Math.sin(a);
  const y = turned.x * Math.sin(a) + turned.y * Math.cos(a);
  const clamp = (v: number) => Math.max(-1, Math.min(1, v / TILT_FULL_DEG));
  return { x: clamp(x), y: clamp(y) };
}
