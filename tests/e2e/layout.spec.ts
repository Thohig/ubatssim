import { expect, test } from '@playwright/test';
import { box, open, overlaps, startFree, watchErrors } from './helpers';

test.describe('phone (375×812)', () => {
  test.use({ viewport: { width: 375, height: 812 }, hasTouch: true, isMobile: true });

  test('the status bar, the log, the view buttons and the screen controls do not overlap', async ({ page }) => {
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

  test('uses the compact layout: the long instrument panel covered the log and the periscope', async ({ page }) => {
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

test('desktop: the instrument panel, the log and the screen controls do not overlap', async ({ page }) => {
  const errors = watchErrors(page);
  await page.setViewportSize({ width: 1280, height: 800 });
  await open(page);
  await startFree(page);
  await expect(page.locator('#log')).toBeVisible();
  const parts = ['#instruments', '#top-center', '#view-btns', '#helm', '.helm-views'];
  const boxes = await Promise.all(parts.map((p) => box(page, p)));
  for (let i = 0; i < parts.length; i++) {
    for (let j = i + 1; j < parts.length; j++) {
      const a = boxes[i];
      const b = boxes[j];
      if (a && b) expect(overlaps(a, b), `${parts[i]} and ${parts[j]}`).toBe(false);
    }
  }
  // The view buttons: one column at the right edge, the views over the masts.
  const order = await page.locator('.helm-views button').evaluateAll((bs) =>
    bs.map((b) => ({ v: (b as HTMLElement).dataset.v, ...b.getBoundingClientRect().toJSON() })),
  );
  expect(order.map((b) => b.v)).toEqual(['view', 'chart', 'sonar', 'periscope', 'snorkel', 'radar']);
  for (const b of order) expect(b.right).toBeGreaterThan(1280 - 64);
  for (const [i, b] of order.slice(1).entries()) expect(b.top).toBeGreaterThan(order[i]!.bottom);
  errors.check();
});

test('mid-sized screen (1024×700): periscope, fire panel and chart overlap nothing', async ({ page }) => {
  // The log ran under the instrument panel and the chart, and the view pill under both.
  const errors = watchErrors(page);
  await page.setViewportSize({ width: 1024, height: 700 });
  await open(page);
  await startFree(page, 'westCoast', 'periscope');
  await page.keyboard.press('p');
  await expect(page.locator('body')).toHaveClass(/onboard/, { timeout: 20_000 });
  await page.keyboard.press('k');
  await expect(page.locator('#nav')).toBeVisible();
  const parts = ['#instruments', '#top-center', '#view-btns', '#helm', '#fire', '#nav', '#mode', '.helm-views'];
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
