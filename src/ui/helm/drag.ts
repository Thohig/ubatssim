/** Tap-or-drag on the screen controls (scales, gauges, the telegraph lever). */

/**
 * Tap-or-drag on an element: `pick` maps the pointer to a value shown while
 * the finger is down; `commit` gets the value on release. Cancelled drags
 * send nothing.
 */
export function bindDrag<T>(
  el: HTMLElement,
  pick: (fx: number, fy: number) => T,
  preview: (v: T | null) => void,
  commit: (v: T) => void,
  onStart?: () => void,
  enabled: () => boolean = () => true,
): void {
  let active = false;
  let value: T | null = null;
  const at = (e: PointerEvent) => {
    const r = el.getBoundingClientRect();
    const fx = r.width > 0 ? (e.clientX - r.left) / r.width : 0.5;
    const fy = r.height > 0 ? (e.clientY - r.top) / r.height : 0.5;
    value = pick(fx, fy);
    preview(value);
  };
  el.addEventListener('pointerdown', (e) => {
    if (!enabled()) return;
    e.preventDefault();
    active = true;
    onStart?.();
    try {
      el.setPointerCapture?.(e.pointerId);
    } catch {
      // Synthetic events (tests) have no active pointer to capture.
    }
    at(e);
  });
  el.addEventListener('pointermove', (e) => {
    if (active) at(e);
  });
  el.addEventListener('pointerup', () => {
    if (!active) return;
    active = false;
    if (value !== null) commit(value);
    value = null;
    preview(null);
  });
  el.addEventListener('pointercancel', () => {
    active = false;
    value = null;
    preview(null);
  });
}
