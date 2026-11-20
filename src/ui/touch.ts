import type { Controller } from '../control/controller';
import type { Order } from '../control/orders';
import type { InputModeState } from './inputMode';

export interface TouchButton {
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
export function makeButton(b: TouchButton, fire: (b: TouchButton) => void, mode: InputModeState): HTMLButtonElement {
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
    // Tapping a steering button closes the console, as Esc does.
    if (mode.current === 'console') mode.set('steer');
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

/**
 * On-screen buttons for the realistic simulation on touch devices (the
 * simplified simulation has its own screen controls, see helm.ts). Each
 * button submits the same Order objects as the keyboard, with source
 * 'touch'. Holding a rudder, planes or speed button repeats it.
 */
export function bindTouchControls(
  root: HTMLElement,
  getCtrl: () => Controller | null,
  mode: InputModeState,
  openConsole: () => void,
): void {
  type Group = { name: string; buttons: TouchButton[] };
  const groups: Group[] = [
    {
      name: 'Roder',
      buttons: [
        { label: '◀ BB', title: 'Roder 5° babord', order: { kind: 'rudder', angle: -5, relative: true }, repeat: true },
        { label: 'Mitt', title: 'Roder midskepps', order: { kind: 'rudder', angle: 0 } },
        { label: 'SB ▶', title: 'Roder 5° styrbord', order: { kind: 'rudder', angle: 5, relative: true }, repeat: true },
      ],
    },
    {
      name: 'Djuproder',
      buttons: [
        { label: '▲ Upp', title: 'Djuproder 5° upp', order: { kind: 'planes', angle: -5, relative: true }, repeat: true },
        { label: '▼ Ned', title: 'Djuproder 5° ned', order: { kind: 'planes', angle: 5, relative: true }, repeat: true },
      ],
    },
    {
      name: 'Fart',
      buttons: [
        { label: '−', title: 'Fart −1 knop', order: { kind: 'adjustSpeed', deltaKnots: -1 }, repeat: true },
        { label: '+', title: 'Fart +1 knop', order: { kind: 'adjustSpeed', deltaKnots: 1 }, repeat: true },
      ],
    },
    {
      name: 'Konsol',
      buttons: [{ label: '>_', title: 'Öppna kommandokonsolen', action: openConsole, className: 'console-btn' }],
    },
  ];

  const fire = (b: TouchButton) => {
    const ctrl = getCtrl();
    if (ctrl && b.order) ctrl.submit(b.order, 'touch');
    if (ctrl && b.run) b.run(ctrl);
    b.action?.();
  };

  root.innerHTML = '';
  for (const g of groups) {
    const row = document.createElement('div');
    row.className = 'touch-row';
    for (const b of g.buttons) row.append(makeButton(b, fire, mode));
    const label = document.createElement('div');
    label.className = 'touch-label';
    label.textContent = g.name;
    const group = document.createElement('div');
    group.className = 'touch-group';
    group.append(label, row);
    root.append(group);
  }
}

/** True on phones and tablets (coarse primary pointer). */
export const isTouchDevice = (): boolean =>
  window.matchMedia('(pointer: coarse)').matches || navigator.maxTouchPoints > 0;
