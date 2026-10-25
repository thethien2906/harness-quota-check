import { test, expect } from '@playwright/test';
test('compact gauges have no visible labels and expand against the same edge', async ({ page }) => {
  await page.goto('/?preview=1');
  const rail = page.getByRole('navigation', { name: 'Tool quotas' });
  await expect(rail.getByRole('button')).toHaveCount(3);
  await expect(rail).toHaveText('');
  const compactRect = await rail.boundingBox();
  await page.screenshot({ path: '.cache/ui-compact.png', fullPage: true });
  const codex = rail.getByRole('button', { name: /Codex/ });
  await expect(codex.locator('.gauge')).toHaveCSS('opacity', '0');
  await codex.hover(); await expect(codex.locator('.gauge')).toHaveCSS('opacity', '1');
  await codex.click();
  await expect(page.getByRole('heading', { name: 'Codex', exact: true })).toBeVisible();
  const detailRect = await page.locator('article.panel').boundingBox();
  await page.screenshot({ path: '.cache/ui-detail.png', fullPage: true });
  expect(Math.abs(compactRect!.x + compactRect!.width - detailRect!.x - detailRect!.width)).toBeLessThan(2);
  await page.getByRole('button', { name: 'Back to compact' }).click();
  await expect(rail).toBeVisible();
});
test('off tools show no gauges and detail explains why', async ({ page }) => {
  await page.goto('/?preview=1');
  await page.getByRole('combobox', { name: 'Sample state' }).selectOption('off');
  await expect(page.locator('.harness-icon.unavailable')).toHaveCount(3);
  await page.locator('.harness-icon').first().click();
  await expect(page.getByRole('heading', { name: 'Codex not running' })).toBeVisible();
  await expect(page.getByRole('progressbar')).toHaveCount(0);
});
test('Argon uses its model quota, not Claude/GPT five-hour quota', async ({ page }) => {
  await page.goto('/?preview=1');
  const icon = page.getByRole('button', { name: /Antigravity, quota remaining 38%/ });
  await expect(icon).toBeVisible();
  await icon.click();
  await page.locator('summary').click();
  await expect(page.getByText('Gemini 4 Argon', { exact: true })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('navigation', { name: 'Tool quotas' })).toBeVisible();
});
test('browser never pretends fixtures are real by default', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('.harness-icon.unavailable')).toHaveCount(3);
  await expect(page.getByText('Desktop not connected', { exact: true })).toBeVisible();
});

test('edge reveal reuses the rail and animates without remounting or moving its anchor', async ({ page }) => {
  await page.goto('/?preview=1');
  const rail = page.locator('.compact-rail');
  await rail.evaluate(element => { (element as HTMLElement).dataset.mountProbe = 'preserved'; });
  const before = await rail.boundingBox();
  await page.getByRole('button', { name: 'Hide', exact: true }).click();
  await expect(rail).toHaveAttribute('aria-hidden', 'true');
  await expect(rail).toHaveAttribute('inert', '');
  const trigger = page.getByRole('button', { name: 'Open Quota Peek', exact: true });
  await trigger.hover();
  await expect(rail).toHaveAttribute('aria-hidden', 'false');
  await expect(rail).toHaveAttribute('data-mount-probe', 'preserved');
  await expect(rail).toHaveCSS('opacity', '1');
  // Opacity finishes before the slide; measure the anchor after transform.
  await expect.poll(async () => Math.abs(before!.x - (await rail.boundingBox())!.x)).toBeLessThan(1);
  const after = await rail.boundingBox();
  expect(Math.abs(before!.x - after!.x)).toBeLessThan(1);
  expect(before!.width).toEqual(after!.width);
});

test('edge motion honors reduced-motion preferences', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/?preview=1');
  await page.getByRole('button', { name: 'Hide', exact: true }).click();
  await page.getByRole('button', { name: 'Open Quota Peek', exact: true }).hover();
  await expect(page.locator('.compact-rail')).toHaveCSS('transition-duration', '0s');
});
