/**
 * Small DOM helpers for the HUD and the menus, without a framework.
 *
 *   html`<p>${text}</p>`   a template where every inserted value is escaped,
 *                          unless it is itself `html` (or `raw`). Arrays are
 *                          joined. false, null and undefined insert nothing.
 *   h('div', { class: 'x' }, child…)   creates an element; strings become text nodes.
 *
 * A component creates its elements once and updates only text and values
 * afterwards (see `Component`).
 */

/** HTML that is safe to insert: produced by `html` or explicitly marked with `raw`. */
export class SafeHtml {
  constructor(readonly value: string) {}
  toString(): string {
    return this.value;
  }
}

const ESC: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const escapeHtml = (s: string): string => s.replace(/[&<>"']/g, (c) => ESC[c]!);

type Value = SafeHtml | string | number | boolean | null | undefined | readonly Value[];

function render(v: Value): string {
  if (v instanceof SafeHtml) return v.value;
  if (Array.isArray(v)) return (v as readonly Value[]).map(render).join('');
  if (v === null || v === undefined || v === false || v === true) return '';
  return escapeHtml(String(v));
}

export function html(strings: TemplateStringsArray, ...values: Value[]): SafeHtml {
  let out = strings[0]!;
  for (let i = 0; i < values.length; i++) out += render(values[i]!) + strings[i + 1]!;
  return new SafeHtml(out);
}

/** Marks trusted, static markup (never player or scenario text). */
export const raw = (s: string): SafeHtml => new SafeHtml(s);

/** Replaces an element's content. */
export function mount(el: Element, content: SafeHtml): void {
  el.innerHTML = content.value;
}

type Child = Node | string | number | null | undefined | false;

export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Record<string, string | number | boolean | undefined> | null = null,
  ...children: Child[]
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props ?? {})) {
    if (v === undefined || v === false) continue;
    if (k === 'class') el.className = String(v);
    else if (k.startsWith('data-')) el.dataset[k.slice(5).replace(/-([a-z])/g, (_, c: string) => c.toUpperCase())] = String(v);
    else el.setAttribute(k, v === true ? '' : String(v));
  }
  for (const c of children) {
    if (c === null || c === undefined || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}

/** A piece of the interface: created once, then updated with new values. */
export interface Component<T> {
  readonly el: HTMLElement;
  update(value: T): void;
}
