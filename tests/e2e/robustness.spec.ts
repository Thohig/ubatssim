import { expect, test, type Page } from '@playwright/test';
import { open, startFree, watchErrors } from './helpers';

const menu = (page: Page) => page.locator('#menu');

/**
 * Whether the 3D view holds a picture. Read in an animation frame after the
 * game's own (which asks for the next frame first), before the browser
 * clears the drawing buffer.
 */
const drawn = (page: Page) =>
  page.evaluate(
    () =>
      new Promise<boolean>((resolve) =>
        requestAnimationFrame(() => {
          const c = document.querySelector<HTMLCanvasElement>('#app canvas')!;
          const probe = document.createElement('canvas');
          probe.width = probe.height = 8;
          const g = probe.getContext('2d')!;
          g.drawImage(c, 0, 0, 8, 8);
          resolve([...g.getImageData(0, 0, 8, 8).data].some((v, i) => i % 4 !== 3 && v > 10));
        }),
      ),
  );

test('lost graphics pause the game; when they come back the game continues', async ({ page }) => {
  const errors = watchErrors(page);
  await open(page);
  await startFree(page);
  expect(await drawn(page)).toBe(true);
  await page.evaluate(() => {
    const gl = document.querySelector<HTMLCanvasElement>('#app canvas')!.getContext('webgl2')!;
    (window as unknown as { lose: WEBGL_lose_context }).lose = gl.getExtension('WEBGL_lose_context')!;
    (window as unknown as { lose: WEBGL_lose_context }).lose.loseContext();
  });
  await expect(menu(page)).toHaveAttribute('data-screen', 'graphics');
  await expect(menu(page).locator('[data-action="graphicsOk"]')).toHaveCount(0);
  expect(await drawn(page)).toBe(false);
  await page.keyboard.press('Escape'); // does nothing while the graphics are gone
  await expect(menu(page)).toHaveAttribute('data-screen', 'graphics');
  await page.evaluate(() => (window as unknown as { lose: WEBGL_lose_context }).lose.restoreContext());
  await menu(page).locator('[data-action="graphicsOk"]').click();
  await expect(menu(page)).toHaveAttribute('data-screen', 'pause');
  await menu(page).locator('[data-action="resume"]').click();
  await expect(menu(page)).toBeHidden();
  // The scene draws again.
  await expect.poll(() => drawn(page), { timeout: 20_000 }).toBe(true);
  // A loss is reported by the browser as a warning, not an error; nothing else may fail.
  errors.check();
});

test('an unexpected error pauses the game and shows a report; Starta om plays again', async ({ page }) => {
  await open(page);
  await startFree(page);
  await page.evaluate(() => setTimeout(() => {
    throw new Error('Provfel från testet');
  }));
  await expect(menu(page)).toHaveAttribute('data-screen', 'error');
  const report = await menu(page).locator('.error-report').inputValue();
  expect(report).toContain('Provfel från testet');
  expect(report).toMatch(/Läge: (playing|paused), fritt spel, simuleringstid \d/);
  await menu(page).locator('[data-action="restart"]').click();
  await expect(menu(page)).toBeHidden();
  await expect(page.locator('#hud')).toBeVisible();
});
