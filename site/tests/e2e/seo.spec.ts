import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
test('canônica ignora filtros; Markdown e métricas são descobertos pelo HTML', async ({
  page,
  request,
}) => {
  await page.goto('/?track=A&view=chart');
  const canonical = await page.locator('link[rel=canonical]').getAttribute('href');
  expect(new URL(canonical!).search).toBe('');
  const markdown = await page
    .locator('link[rel=alternate][type="text/markdown"]')
    .getAttribute('href');
  const response = await request.get(markdown!);
  expect(response.ok()).toBe(true);
  expect(await response.text()).toContain(`canonical: ${JSON.stringify(canonical)}`);
  const graph = JSON.parse(
    (await page.locator('script[type="application/ld+json"]').textContent()) || '',
  );
  expect(graph['@graph'].some((n: { '@type': string }) => n['@type'] === 'FAQPage')).toBe(true);
  const citable = page.locator('[data-citable]').first();
  await expect(citable).toContainText('O benchmark em dados');
  await page.goto('/modelos/');
  const first = page.locator('.article-list a').first();
  if (await first.count()) {
    await first.click();
    const jsonLink = page.getByRole('link', { name: 'Baixar métricas públicas em JSON' }).first();
    const metricResponse = await request.get((await jsonLink.getAttribute('href'))!);
    expect(metricResponse.ok()).toBe(true);
    const metric = await metricResponse.json();
    await expect(page.locator('[data-citable]').first()).toContainText(metric.id);
    expect(metric.dataset_hash).toBeTruthy();
    expect(metric.protocol_hash).toBeTruthy();
    expect(metric.config).toBeUndefined();
  }
});
test('páginas editoriais e trilhas permanecem acessíveis', async ({ page }) => {
  test.setTimeout(120000);
  for (const route of [
    '/sobre/',
    '/como-citar/',
    '/modelos/',
    '/trilhas/',
    '/trilhas/e/',
    '/trilhas/f/',
  ]) {
    const response = await page.goto(route);
    expect(response?.status()).toBe(200);
    await expect(page.locator('h1')).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    expect(
      (await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze())
        .violations,
    ).toEqual([]);
  }
});
