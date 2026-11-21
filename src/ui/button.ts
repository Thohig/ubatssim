/**
 * Screen buttons (the helm and its panels). Steering buttons act on
 * pointerdown and can repeat while held, faster and faster; each press
 * submits ordinary orders with source 'touch'.
 */
import type { Controller } from '../control/controller';
import type { Order } from '../control/orders';

export interface ScreenButton {
  label: string;
  title: string;
  order?: Order;
  /** Submits orders that depend on the controller's state. */
  run?: (ctrl: Controller) => void;
  /** Repeat the order while held. */
  repeat?: boolean;
  action?: () => void;
  className?: string;
}

/** Hold this long before repeating [ms]. */
const HOLD_DELAY = 450;
/** First repeat interval, and the shortest it speeds up to [ms]. */
export const REPEAT_FIRST = 350;
export const REPEAT_FASTEST = 120;

/** The delay before repeat number `n` (0, 1, …) of a held button [ms]: it speeds up while held. */
export const repeatDelay = (n: number): number => Math.max(REPEAT_FASTEST, Math.round(REPEAT_FIRST * 0.8 ** n));

/** A short buzz on devices that support it (Android; not Safari on iOS). */
export function haptic(): void {
  try {
    navigator.vibrate?.(8);
  } catch {
    // Not supported or not allowed: no feedback.
  }
}

/**
 * A screen button. Steering buttons act on pointerdown (and repeat while
 * held when `repeat` is set); buttons with an `action` act on click, since
 * iOS only shows the on-screen keyboard for focus() inside a click handler.
 */
export function makeButton(b: ScreenButton, fire: (b: ScreenButton) => void): HTMLButtonElement {
  const el = document.createElement('button');
  el.type = 'button';
  el.className = `touch-btn ${b.className ?? ''}`;
  el.textContent = b.label;
  el.title = b.title;
  el.setAttribute('aria-label', b.title);
  let timer: number | undefined;
  const stop = () => {
    window.clearTimeout(timer);
    el.classList.remove('pressed');
  };
  if (b.action) {
    el.addEventListener('click', () => fire(b));
    return el;
  }
  el.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    el.classList.add('pressed');
    haptic();
    fire(b);
    if (b.repeat) {
      let n = 0;
      const again = () => {
        fire(b);
        timer = window.setTimeout(again, repeatDelay(++n));
      };
      timer = window.setTimeout(again, HOLD_DELAY);
    }
  });
  el.addEventListener('pointerup', stop);
  el.addEventListener('pointercancel', stop);
  el.addEventListener('pointerleave', stop);
  el.addEventListener('contextmenu', (e) => e.preventDefault());
  return el;
}

/** True on phones and tablets (coarse primary pointer). */
export const isTouchDevice = (): boolean =>
  window.matchMedia('(pointer: coarse)').matches || navigator.maxTouchPoints > 0;
