import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
test('páginas, navegação e acessibilidade', async ({ page }) => {
  test.setTimeout(120000); // Ten full-page accessibility audits share this test budget.
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

test('mapa e grupos de trilhas respondem à seleção', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'E · Previsão', exact: true }).click();
  await expect(page.locator('#map-title')).toHaveText('E · Previsão');
  await expect(page.locator('[data-sector="E"]')).toHaveClass(/selected/);
  await expect(page.locator('#map-link')).toHaveAttribute('href', '#trilha-E');
  await page.getByRole('button', { name: 'Compreensão', exact: true }).click();
  await expect(page.locator('.track:visible')).toHaveCount(4);
  await expect(page.locator('#trilha-E')).toBeHidden();
  await page.getByRole('button', { name: 'Todas', exact: true }).click();
  await expect(page.locator('.track:visible')).toHaveCount(8);
});

test('gráfico, URL, CSV e estado vazio preservam o recorte', async ({ page }) => {
  await page.goto('/');
  test.skip((await page.locator('#leaderboard tbody tr').count()) === 0, 'Sem resultados');
  const originalCount = await page.locator('#leaderboard tbody tr:visible').count();
  await page.getByRole('button', { name: 'Gráfico', exact: true }).click();
  await expect(page.locator('.chart-row')).toHaveCount(originalCount);
  await expect(page.locator('#table-view')).toBeHidden();
  await expect(page.locator('#comparison-warning')).toBeHidden();
  expect(new URL(page.url()).searchParams.get('view')).toBe('chart');
  await page.reload();
  await expect(page.locator('#chart-view')).toBeVisible();
  await page.getByText('Mais filtros', { exact: false }).click();
  await page.locator('#since').fill('2099-01-01');
  await expect(page.locator('#filter-empty')).toBeVisible();
  await expect(page.getByRole('button', { name: 'CSV', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: 'Mostrar todos os resultados' }).click();
  await expect(page.locator('#comparison-warning')).toBeVisible();
  const visibleCount = await page.locator('.chart-row').count();
  const downloaded = page.waitForEvent('download');
  await page.getByRole('button', { name: 'CSV', exact: true }).click();
  const download = await downloaded;
  const stream = await download.createReadStream();
  const chunks: Buffer[] = [];
  for await (const chunk of stream!) chunks.push(chunk as Buffer);
  const lines = Buffer.concat(chunks).toString('utf8').trim().split('\r\n');
  expect(lines.length).toBe(visibleCount + 1);
  expect(lines[0]).toContain('dataset_e_protocolo');
  await page.getByRole('button', { name: 'Tabela', exact: true }).click();
  await page.getByRole('button', { name: 'Ordenar por nota' }).click();
  const scores = await page
    .locator('#leaderboard tbody tr:visible')
    .evaluateAll((rows) => rows.map((row) => Number((row as HTMLElement).dataset.score)));
  expect(scores).toEqual([...scores].sort((a, b) => a - b));
});

test('navegação móvel, largura e movimento reduzido', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  const menu = page.locator('.menu-toggle');
  if (await menu.isVisible()) {
    await menu.click();
    await expect(menu).toHaveAttribute('aria-expanded', 'true');
    await expect(page.getByRole('navigation', { name: 'Principal', exact: true })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(menu).toHaveAttribute('aria-expanded', 'false');
    await expect(menu).toBeFocused();
  }
  await expect(page.locator('.tagline span').first()).toHaveCSS('color', 'rgb(4, 22, 39)');
});

test('quiz valida, confere por Enter, avança e reinicia com itens de teste', async ({ page }) => {
  // Browser-only fixtures exercise the exported-data path without publishing test content.
  const quiz = [1, 2].map((n) => ({
    id: `fixture-${n}`,
    track: 'C',
    task: 'yes_count',
    chamber: 'camara',
    mode: 'with_context',
    prompts: [`Pergunta de teste ${n}: quantos votos aparecem no contexto?`],
    context: { votos: n },
    answer: { type: 'integer', value: n },
    evidence: [{ ref: 'fixture', url: 'https://dadosabertos.camara.leg.br/' }],
  }));
  await page.route('**/quiz/', async (route) => {
    const response = await route.fetch();
    const html = (await response.text()).replace(
      /(<script[^>]*id="quiz-data"[^>]*>)[\s\S]*?(<\/script>)/,
      (_, start, end) => start + JSON.stringify({ quiz, predictions: [] }) + end,
    );
    await route.fulfill({ response, body: html });
  });
  await page.goto('/quiz/');
  await expect(page.locator('#quiz-feedback a')).toHaveCount(0);
  await page.getByRole('button', { name: 'Conferir resposta' }).click();
  await expect(page.locator('#quiz-answer')).toHaveAttribute('aria-invalid', 'true');
  await page.locator('#quiz-answer').fill('1');
  await page.locator('#quiz-answer').press('Enter');
  await expect(page.locator('#quiz-feedback')).toContainText('Resposta correta.');
  await expect(page.locator('#quiz-feedback a')).toHaveAttribute('href', quiz[0].evidence[0].url);
  await page.locator('#quiz-next').click();
  await expect(page.locator('#quiz-answer')).toBeFocused();
  await expect(page.locator('#quiz-progress')).toHaveText('2 de 2');
  await page.locator('#quiz-answer').fill('2');
  await page.locator('#quiz-answer').press('Enter');
  await page.locator('#quiz-next').click();
  await expect(page.locator('#quiz')).toContainText('2.0 de 2 pontos');
  expect(await page.evaluate(() => localStorage.length + sessionStorage.length)).toBe(0);
  await page.getByRole('button', { name: 'Tentar novamente' }).click();
  await expect(page.locator('#quiz-progress')).toHaveText('1 de 2');
});
