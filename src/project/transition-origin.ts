let origin: { x: number; y: number } | null = null;

export function setTransitionOrigin(x: number, y: number): void {
  origin = { x, y };
}

export function consumeTransitionOrigin(): { x: number; y: number } | null {
  const o = origin;
  origin = null;
  return o;
}
