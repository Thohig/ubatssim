import { expect, test } from '@playwright/test';
import { open, watchErrors } from './helpers';

test('a scenario starts with the briefing; the objective folds to one line and opens on a tap', async ({ page }) => {
  const errors = watchErrors(page);
  await open(page, {}); // the introduction has not been seen
  await page.locator('[data-action="nav"][data-arg="scenarios"]').click();
  await page.locator('[data-action="scenario"][data-arg="first-dive"]').click();

  const menu = page.locator('#menu');
  await expect(menu).toHaveAttribute('data-screen', 'briefing');
  await expect(menu.locator('.briefing-goals li')).toHaveCount(6);
  await expect(menu.locator('.briefing-goals li').first()).toHaveText('Klara bryggan');

  // Besättning and back again.
  await menu.locator('[data-action="nav"][data-arg="crew"]').click();
  await expect(menu).toHaveAttribute('data-screen', 'crew');
  await menu.locator('[data-action="back"]').click();
  await expect(menu).toHaveAttribute('data-screen', 'briefing');

  await menu.locator('[data-action="briefingDone"]').click();
  // The first game shows the introduction to the crew, then plays.
  await expect(menu).toHaveAttribute('data-screen', 'intro');
  // The objective opens by itself for 6 s of real time. On a slow CI machine that can pass before
  // an assertion gets to look, so record the opening as it happens instead of trying to catch it.
  await page.evaluate(() => {
    const el = document.getElementById('objective')!;
    const w = window as unknown as { objectiveOpened: boolean };
    w.objectiveOpened = el.classList.contains('expanded');
    new MutationObserver(() => {
      if (el.classList.contains('expanded')) w.objectiveOpened = true;
    }).observe(el, { attributes: true, attributeFilter: ['class'] });
  });
  await menu.locator('[data-action="introDone"]').click();
  await expect(menu).toBeHidden();

  const objective = page.locator('#objective');
  await expect(objective).toBeVisible();
  await expect(objective.locator('.obj-step')).toHaveText('1/6');
  await expect.poll(() => page.evaluate(() => (window as unknown as { objectiveOpened: boolean }).objectiveOpened)).toBe(true);
  // Folds by itself after a few seconds of play.
  await expect(objective).not.toHaveClass(/expanded/);
  const folded = await objective.boundingBox();
  await objective.locator('.obj-head').click();
  await expect(objective).toHaveClass(/expanded/);
  await expect(objective.locator('.obj-list li')).toHaveCount(6);
  expect((await objective.boundingBox())!.height).toBeGreaterThan(folded!.height * 2);

  // The game runs: the simulation time moves on.
  await expect(page.locator('#log')).toContainText('Scenario: Första dykningen');
  errors.check();
});

test('Esc pauses; the log book is in the pause menu; Fortsätt continues the game', async ({ page }) => {
  const errors = watchErrors(page);
  await open(page);
  await page.locator('[data-action="nav"][data-arg="scenarios"]').click();
  await page.locator('[data-action="scenario"][data-arg="trim-drill"]').click();
  await page.keyboard.press('Escape'); // Esc on the briefing = Till sjöss
  await expect(page.locator('#menu')).toBeHidden();
  await page.keyboard.press('Escape');
  await expect(page.locator('#menu')).toHaveAttribute('data-screen', 'pause');
  // ☰ → Loggbok: the history, even after the lines on screen have faded.
  await page.locator('[data-action="nav"][data-arg="logbook"]').click();
  await expect(page.locator('#menu .logbook')).toContainText('Scenario: Trimövning');
  await page.keyboard.press('Escape');
  await expect(page.locator('#menu')).toHaveAttribute('data-screen', 'pause');
  await page.locator('[data-action="resume"]').click();
  await expect(page.locator('#menu')).toBeHidden();
  errors.check();
});
