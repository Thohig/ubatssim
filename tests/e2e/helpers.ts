import { expect, type Page } from '@playwright/test';

/** Collects console errors and uncaught exceptions; `check()` fails the test if there were any. */
export function watchErrors(page: Page): { check: () => void } {
  const errors: string[] = [];
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  page.on('pageerror', (e) => errors.push(e.message));
  return { check: () => expect(errors, errors.join('\n')).toEqual([]) };
}

/**
 * Without a graphics card (CI, headless) the 3D view is drawn in software at a
 * few frames per second; without particles and light rays about twice as fast.
 */
const LIGHT = { particles: false, lightRays: false };

/** Opens the game with the introduction already seen (it is tested on its own). */
export async function open(page: Page, settings: Record<string, unknown> = { crewIntroSeen: true }): Promise<void> {
  await page.addInitScript((s) => {
    try {
      localStorage.setItem('ubatssim.settings', JSON.stringify(s));
    } catch {
      /* private mode: the defaults apply */
    }
  }, { ...LIGHT, ...settings });
  await page.goto('./');
  await expect(page.locator('#menu[data-screen="main"]')).toBeVisible();
}

/** Free play from the main menu: an area and a start. */
export async function startFree(page: Page, area = 'westCoast', start = 'periscope'): Promise<void> {
  await page.locator('[data-action="nav"][data-arg="free"]').click();
  await page.locator(`[data-action="area"][data-arg="${area}"]`).click();
  await page.locator(`[data-action="free"][data-arg="${start}"]`).click();
  await expect(page.locator('#hud')).toBeVisible();
  await expect(page.locator('#menu')).toBeHidden();
}

export type Box = { x: number; y: number; width: number; height: number };

/** The element's box, or null while it is not shown. */
export async function box(page: Page, selector: string): Promise<Box | null> {
  const loc = page.locator(selector).first();
  if (!(await loc.isVisible())) return null;
  return loc.boundingBox();
}

export const overlaps = (a: Box, b: Box): boolean =>
  a.x < b.x + b.width - 0.5 && b.x < a.x + a.width - 0.5 && a.y < b.y + b.height - 0.5 && b.y < a.y + a.height - 0.5;
