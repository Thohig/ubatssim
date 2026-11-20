import type { Controller } from '../control/controller';
import type { GameMode } from '../control/gameMode';
import type { Order } from '../control/orders';
import type { InputModeState } from './inputMode';
import { submitDive } from './keyboard';

interface TouchButton {
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

const HOLD_DELAY = 450;
const REPEAT_INTERVAL = 350;

/**
 * On-screen controls for touch devices. Each button submits the same Order
 * objects as the keyboard, with source 'touch'. Holding a rudder, planes,
 * depth, heading or speed button repeats it. Both game modes' button sets
 * are built; `root.dataset.mode` (set by main.ts) shows one of them.
 */
export function bindTouchControls(
  root: HTMLElement,
  getCtrl: () => Controller | null,
  mode: InputModeState,
  openConsole: () => void,
): void {
  type Group = { name: string; buttons: TouchButton[] };
  const speed: Group = {
    name: 'Fart',
    buttons: [
      { label: '−', title: 'Fart −1 knop', order: { kind: 'adjustSpeed', deltaKnots: -1 }, repeat: true },
      { label: '+', title: 'Fart +1 knop', order: { kind: 'adjustSpeed', deltaKnots: 1 }, repeat: true },
    ],
  };
  const consoleGroup: Group = {
    name: 'Konsol',
    buttons: [{ label: '>_', title: 'Öppna kommandokonsolen', action: openConsole, className: 'console-btn' }],
  };
  const sets: Record<GameMode, Group[]> = {
    realistic: [
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
      speed,
      consoleGroup,
    ],
    simplified: [
      {
        name: 'Kurs',
        buttons: [
          { label: '◀', title: 'Kurs 10° babord', order: { kind: 'adjustHeading', deltaDegrees: -10 }, repeat: true },
          { label: '▶', title: 'Kurs 10° styrbord', order: { kind: 'adjustHeading', deltaDegrees: 10 }, repeat: true },
        ],
      },
      {
        name: 'Djup',
        buttons: [
          { label: '▲', title: 'Djup 5 m grundare', order: { kind: 'adjustDepth', deltaMetres: -5 }, repeat: true },
          { label: '▼', title: 'Djup 5 m djupare', order: { kind: 'adjustDepth', deltaMetres: 5 }, repeat: true },
        ],
      },
      speed,
      {
        name: 'Ballast',
        buttons: [
          { label: 'Dyk', title: 'Dyk: fyll huvudballasten', run: (c) => submitDive(c, 'touch') },
          { label: 'Yta', title: 'Ytläge: blås huvudballasten', order: { kind: 'surface' } },
        ],
      },
      consoleGroup,
    ],
  };

  root.innerHTML = '';
  for (const [gameMode, groups] of Object.entries(sets)) {
    const set = document.createElement('div');
    set.className = 'touch-set';
    set.dataset.mode = gameMode;
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
      set.append(group);
    }
    root.append(set);
  }

  function fire(b: TouchButton): void {
    const ctrl = getCtrl();
    if (ctrl && b.order) ctrl.submit(b.order, 'touch');
    if (ctrl && b.run) b.run(ctrl);
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
