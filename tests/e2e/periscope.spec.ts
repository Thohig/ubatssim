import { expect, test } from '@playwright/test';
import { open, startFree, watchErrors } from './helpers';

for (const size of [
  { name: 'desktop', width: 1280, height: 800 },
  { name: 'phone', width: 375, height: 812 },
  { name: 'phone, landscape', width: 812, height: 375 },
]) {
  test(`the fire panel does not cover the cross hair or the horizon (${size.name})`, async ({ page }) => {
    const errors = watchErrors(page);
    await page.setViewportSize({ width: size.width, height: size.height });
    await open(page);
    await startFree(page, 'westCoast', 'periscope');
    await page.keyboard.press('p'); // periscope up; the view opens when the mast is up (8 s)
    await expect(page.locator('body')).toHaveClass(/onboard/, { timeout: 20_000 });
    const fire = page.locator('#fire');
    await expect(fire).toBeVisible();
    const b = (await fire.boundingBox())!;
    const cx = size.width / 2;
    const cy = size.height / 2;
    // The cross hair is at the centre and the horizon runs across it.
    const coversCentre = b.x <= cx && cx <= b.x + b.width && b.y <= cy && cy <= b.y + b.height;
    expect(coversCentre).toBe(false);
    const coversHorizon = b.y <= cy && cy <= b.y + b.height && b.width > size.width * 0.5;
    expect(coversHorizon).toBe(false);
    errors.check();
  });
}
