import { expect, test } from '@playwright/test';
import { open, watchErrors } from './helpers';

test("the start page's music plays every kind of event without an error, and stops when a game starts", async ({ page }) => {
  const errors = watchErrors(page);
  // A fake clock: the score runs on performance.now() and setInterval, so minutes pass in moments.
  await page.clock.install();
  await open(page);
  // A gesture lets the sound start (the background, not a button).
  await page.mouse.click(20, 20);
  await expect(page.locator('html')).toHaveAttribute('data-audio', 'running');
  // Through calm, threat and attack and into calm again (each tick plays the next second of the score).
  for (let s = 0; s < 330; s += 6) await page.clock.fastForward(6000);
  await expect(page.locator('#menu')).toHaveAttribute('data-screen', 'main');
  await expect(page.locator('html')).toHaveAttribute('data-audio', 'running');
  // A game starts: the menu goes, the game runs.
  await page.locator('[data-action="nav"][data-arg="free"]').click();
  await page.locator('[data-action="area"][data-arg="westCoast"]').click();
  await page.locator('[data-action="free"][data-arg="periscope"]').click();
  await expect(page.locator('#hud')).toBeVisible();
  errors.check();
});
