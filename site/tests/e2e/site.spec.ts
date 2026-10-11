import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
test('páginas, navegação e acessibilidade', async ({ page }) => {
  for (const url of [
    '/',
    '/metodologia/',
    '/dados/',
    '/contribuir/',
    '/revisar/',
    '/erratas/',
    '/analises/',
    '/rodadas/',
    '/explorador/',
    '/quiz/',
  ]) {
    const response = await page.goto(url);
    expect(response?.status()).toBe(200);
    await expect(page.locator('h1')).toBeVisible();
    const audit = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
      .analyze();
    expect(audit.violations).toEqual([]);
  }
});
test('explorador carrega Parquet sem backend', async ({ page }) => {
  await page.goto('/explorador/');
  const text = await page.locator('#explorer-status').textContent();
  test.skip(Boolean(text?.includes('Nenhum conjunto público')), 'Sem exportação local');
  await page.getByRole('button', { name: 'Carregar próxima partição' }).click();
  await expect(page.locator('#items details').first()).toBeVisible({ timeout: 60000 });
  await expect(page.locator('#explorer-status')).toContainText('partições carregadas');
});
test('quiz revela fonte somente depois da resposta', async ({ page }) => {
  await page.goto('/quiz/');
  test.skip(
    Boolean((await page.locator('#quiz').textContent())?.includes('ficará disponível')),
    'Sem exportação local',
  );
  await page.locator('#quiz-answer').fill('resposta de teste');
  await page.getByRole('button', { name: 'Conferir resposta' }).click();
  await expect(page.locator('#quiz-feedback')).toContainText('Gabarito:');
  await expect(page.locator('#quiz-feedback a').first()).toBeVisible();
  await expect(page.locator('#quiz-next')).toBeVisible();
});

test('filtros preservam a comparação por casa e trilha', async ({ page }) => {
  await page.goto('/');
  test.skip((await page.locator('#leaderboard tbody tr').count()) === 0, 'Sem resultados locais');
  await page.locator('#track').selectOption('A');
  await page.locator('#chamber').selectOption('camara');
  const rows = page.locator('#leaderboard tbody tr:visible');
  expect(await rows.count()).toBeGreaterThan(0);
  for (const row of await rows.all()) {
    await expect(row).toHaveAttribute('data-track', 'A');
    await expect(row).toHaveAttribute('data-chamber', 'camara');
  }
  await rows.first().getByRole('link').click();
  await expect(page.locator('h1')).toBeVisible();
  expect(
    (await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze()).violations,
  ).toEqual([]);
});

test('quiz termina sem persistir respostas', async ({ page }) => {
  await page.goto('/quiz/');
  test.skip((await page.locator('#quiz-answer').count()) === 0, 'Sem conjunto local');
  const total = Number((await page.locator('#quiz-progress').textContent())?.split(' de ')[1]);
  expect(total).toBeGreaterThan(0);
  for (let n = 0; n < total; n++) {
    await page.locator('#quiz-answer').fill('resposta de teste');
    await page.getByRole('button', { name: 'Conferir resposta' }).click();
    await page.locator('#quiz-next').click();
  }
  await expect(page.locator('#quiz')).toContainText(`de ${total} pontos`);
  expect(await page.evaluate(() => localStorage.length + sessionStorage.length)).toBe(0);
});

test('revisão local exporta julgamento com evidência e versão', async ({ page }) => {
  await page.goto('/review-local.html');
  await page.locator('#file').setInputFiles({
    name: 'review-batch.json',
    mimeType: 'application/json',
    buffer: Buffer.from(
      JSON.stringify({ items: [{ item_id: 'fixture-item', item_hash: 'fixture-version' }] }),
    ),
  });
  await page.locator('#reviewer').fill('revisor de teste');
  await page.locator('#evidence').fill('Evidência presente no documento de teste.');
  await page.locator('#save').click();
  const downloaded = page.waitForEvent('download');
  await page.locator('#export').click();
  const download = await downloaded;
  const stream = await download.createReadStream();
  const chunks: Buffer[] = [];
  for await (const chunk of stream!) chunks.push(chunk as Buffer);
  const review = JSON.parse(Buffer.concat(chunks).toString('utf8').trim());
  expect(review.item_hash).toBe('fixture-version');
  expect(review.judgement).toBe('supported');
  expect(review.evidence).toContain('Evidência');
  expect(
    (await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze()).violations,
  ).toEqual([]);
});
