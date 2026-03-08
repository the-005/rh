export interface PendingTransition {
  rect: { x: number; y: number; width: number; height: number };
  startIndex: number;
}

let pending: PendingTransition | null = null;

export function setPendingTransition(
  rect: { x: number; y: number; width: number; height: number },
  startIndex: number,
): void {
  pending = { rect, startIndex };
}

export function consumePendingTransition(): PendingTransition | null {
  const p = pending;
  pending = null;
  return p;
}
