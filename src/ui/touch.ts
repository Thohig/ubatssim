import type { Controller } from '../control/controller';
import type { Order } from '../control/orders';
import type { InputModeState } from './inputMode';

interface TouchButton {
  label: string;
  title: string;
  order?: Order;
  /** Repeat the order while held. */
  repeat?: boolean;
  action?: () => void;
  className?: string;
}

const HOLD_DELAY = 450;
const REPEAT_INTERVAL = 350;

/**
 * On-screen controls for touch devices. Each button submits the same Order
 * objects as the keyboard, with source 'touch'. Holding a rudder, planes or
 * speed button repeats it.
 */
export function bindTouchControls(root: HTMLElement, ctrl: Controller, mode: InputModeState, openConsole: () => void): void {
  const groups: { name: string; buttons: TouchButton[] }[] = [
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

  root.innerHTML = '';
  for (const g of groups) {
    const group = document.createElement('div');
    group.className = 'touch-group';
    const label = document.createElement('div');
    label.className = 'touch-label';
    label.textContent = g.name;
    const row = document.createElement('div');
    row.className = 'touch-row';
    for (const b of g.buttons) row.append(makeButton(b));
    group.append(label, row);
    root.append(group);
  }

  function fire(b: TouchButton): void {
    if (b.order) ctrl.submit(b.order, 'touch');
    b.action?.();
  }

  function makeButton(b: TouchButton): HTMLButtonElement {
    const el = document.createElement('button');
    el.type = 'button';
    el.className = `touch-btn ${b.className ?? ''}`;
    el.textContent = b.label;
    el.title = b.title;
    el.setAttribute('aria-label', b.title);
    let holdTimer: number | undefined;
    let repeatTimer: number | undefined;
    const stop = () => {
      window.clearTimeout(holdTimer);
      window.clearInterval(repeatTimer);
      el.classList.remove('pressed');
    };
    if (b.action) {
      // iOS only shows the on-screen keyboard for focus() inside a click handler.
      el.addEventListener('click', () => fire(b));
      return el;
    }
    el.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      // Tapping a steering button closes the console, as Esc does.
      if (mode.current === 'console') mode.set('steer');
      el.classList.add('pressed');
      fire(b);
      if (b.repeat) {
        holdTimer = window.setTimeout(() => {
          repeatTimer = window.setInterval(() => fire(b), REPEAT_INTERVAL);
        }, HOLD_DELAY);
      }
    });
    el.addEventListener('pointerup', stop);
    el.addEventListener('pointercancel', stop);
    el.addEventListener('pointerleave', stop);
    el.addEventListener('contextmenu', (e) => e.preventDefault());
    return el;
  }
}

/** True on phones and tablets (coarse primary pointer). */
export const isTouchDevice = (): boolean =>
  window.matchMedia('(pointer: coarse)').matches || navigator.maxTouchPoints > 0;
