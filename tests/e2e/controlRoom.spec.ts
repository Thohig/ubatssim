import { expect, test } from '@playwright/test';
import { box, open, overlaps, startFree, watchErrors } from './helpers';

test('the control room: V goes in, ←/→ go round the stations, a click on the ballast panel opens its panel, Esc goes out', async ({ page }) => {
  const errors = watchErrors(page);
  await page.setViewportSize({ width: 1280, height: 800 });
  await open(page);
  await startFree(page, 'westCoast', 'periscope');
  // At periscope depth with the masts down: the external view, then the control room.
  await page.keyboard.press('v');
  await expect(page.locator('body')).toHaveClass(/\bcontrol\b/);
  await expect(page.locator('#mode')).toContainText('MANÖVERRUM · Periskopet');
  await expect(page.locator('#view-btns [data-v="station"]')).toBeVisible();
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowRight');
  await expect(page.locator('#mode')).toContainText('Ballastpanelen');
  // The ballast panel's screen lies in the middle of the view.
  const canvas = page.locator('#app canvas');
  const c = (await canvas.boundingBox())!;
  await page.mouse.click(c.x + c.width / 2, c.y + c.height * 0.45);
  await expect(page.locator('.helm-panel')).toBeVisible();
  await expect(page.locator('.helm-tab.on')).toHaveText('Ballast');
  // The Plats button goes on to the plot table.
  await page.locator('#view-btns [data-v="station"]').click();
  await expect(page.locator('#mode')).toContainText('Plottbordet');
  // Nothing overlaps.
  const parts = ['#instruments', '#top-center', '#view-btns', '#helm', '.helm-views'];
  const boxes = await Promise.all(parts.map((p) => box(page, p)));
  for (let i = 0; i < parts.length; i++) {
    for (let j = i + 1; j < parts.length; j++) {
      const a = boxes[i];
      const b = boxes[j];
      if (a && b) expect(overlaps(a, b), `${parts[i]} and ${parts[j]}`).toBe(false);
    }
  }
  // Esc closes the open panel first, then leaves the view.
  await page.keyboard.press('Escape');
  await expect(page.locator('.helm-panel')).toBeHidden();
  await expect(page.locator('body')).toHaveClass(/\bcontrol\b/);
  await page.keyboard.press('Escape');
  await expect(page.locator('body')).not.toHaveClass(/\bcontrol\b/);
  errors.check();
});
