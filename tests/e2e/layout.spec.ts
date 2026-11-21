import { expect, test } from '@playwright/test';
import { box, open, overlaps, startFree, watchErrors } from './helpers';

test.describe('phone (375×812)', () => {
  test.use({ viewport: { width: 375, height: 812 }, hasTouch: true, isMobile: true });

  test('the status bar, the objective and log, the view buttons and the screen controls do not overlap', async ({ page }) => {
    const errors = watchErrors(page);
    await open(page);
    await startFree(page);
    const parts = ['#status', '#top-center', '#view-btns', '#helm', '#menu-btn'];
    await expect(page.locator('#status')).toBeVisible();
    const boxes = await Promise.all(parts.map((p) => box(page, p)));
    for (let i = 0; i < parts.length; i++) {
      for (let j = i + 1; j < parts.length; j++) {
        const a = boxes[i];
        const b = boxes[j];
        if (a && b) expect(overlaps(a, b), `${parts[i]} and ${parts[j]}`).toBe(false);
      }
    }
    // Everything inside the screen, and no sideways scrolling.
    for (const [i, b] of boxes.entries()) {
      if (!b) continue;
      expect(b.x, parts[i]).toBeGreaterThanOrEqual(0);
      expect(b.x + b.width, parts[i]).toBeLessThanOrEqual(375.5);
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(375);
    errors.check();
  });
});

test.describe('tablet, portrait (768×1024)', () => {
  test.use({ viewport: { width: 768, height: 1024 }, hasTouch: true, isMobile: true });

  test('uses the compact layout: the long instrument panel covered the objective and the periscope', async ({ page }) => {
    const errors = watchErrors(page);
    await open(page);
    await startFree(page);
    await expect(page.locator('#status')).toBeVisible();
    await expect(page.locator('#instruments')).toBeHidden();
    const parts = ['#status', '#top-center', '#view-btns', '#helm', '#menu-btn'];
    const boxes = await Promise.all(parts.map((p) => box(page, p)));
    for (let i = 0; i < parts.length; i++) {
      for (let j = i + 1; j < parts.length; j++) {
        const a = boxes[i];
        const b = boxes[j];
        if (a && b) expect(overlaps(a, b), `${parts[i]} and ${parts[j]}`).toBe(false);
      }
    }
    errors.check();
  });
});

test('desktop: the instrument panel, the objective and the screen controls do not overlap', async ({ page }) => {
  const errors = watchErrors(page);
  await page.setViewportSize({ width: 1280, height: 800 });
  await open(page);
  await page.locator('[data-action="nav"][data-arg="scenarios"]').click();
  await page.locator('[data-action="scenario"][data-arg="fjord-entry"]').click();
  await page.locator('[data-action="briefingDone"]').click();
  await expect(page.locator('#objective')).toBeVisible();
  const parts = ['#instruments', '#top-center', '#view-btns', '#helm'];
  const boxes = await Promise.all(parts.map((p) => box(page, p)));
  for (let i = 0; i < parts.length; i++) {
    for (let j = i + 1; j < parts.length; j++) {
      const a = boxes[i];
      const b = boxes[j];
      if (a && b) expect(overlaps(a, b), `${parts[i]} and ${parts[j]}`).toBe(false);
    }
  }
  errors.check();
});
