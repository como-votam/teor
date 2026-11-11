import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

const audit = async (page: import('@playwright/test').Page) =>
  (await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze()).violations;

test('páginas, navegação e acessibilidade', async ({ page }) => {
  test.setTimeout(180000);
  // A auditoria de contraste não avalia elementos no meio da animação de entrada.
  await page.emulateMedia({ reducedMotion: 'reduce' });
  for (const url of [
    '/',
    '/modelos/',
    '/comparar/',
    '/explorador/',
    '/desafio/',
    '/trilhas/',
    '/trilhas/a/',
    '/metodologia/',
    '/dados/',
    '/contribuir/',
    '/analises/',
    '/rodadas/',
    '/sobre/',
    '/como-citar/',
  ]) {
    const response = await page.goto(url);
    expect(response?.status()).toBe(200);
    await expect(page.locator('h1')).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    const violations = await audit(page);
    expect(violations.map((v) => `${url} ${v.id}: ${v.nodes.map((n) => n.target.join(' ')).slice(0, 3).join(' | ')}`)).toEqual([]);
  }
});

test('matriz troca casa e valor e abre a fatia com intervalos', async ({ page }) => {
  await page.goto('/');
  test.skip((await page.locator('.matrix td[data-tip]').count()) === 0, 'Sem resultados');
  await page.getByRole('radio', { name: 'Senado' }).first().click();
  await expect(page.locator('tbody[data-chamber="senado"]')).toBeVisible();
  await expect(page.locator('tbody[data-chamber="camara"]')).toBeHidden();
  await page.getByRole('radio', { name: 'Acima da referência' }).click();
  await expect(page.locator('table.matrix')).toHaveAttribute('data-view', 'lift');
  await page.locator('tbody[data-chamber="senado"] [data-slice]').first().click();
  const sheet = page.getByRole('dialog');
  await expect(sheet.locator('.forest-row').first()).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(sheet).toHaveCount(0);
});

test('CSV da matriz exporta uma linha por execução e fatia', async ({ page }) => {
  await page.goto('/');
  test.skip((await page.locator('[data-export]').count()) === 0, 'Sem resultados');
  const downloaded = page.waitForEvent('download');
  await page.locator('[data-export]').click();
  const stream = await (await downloaded).createReadStream();
  const chunks: Buffer[] = [];
  for await (const chunk of stream!) chunks.push(chunk as Buffer);
  const lines = Buffer.concat(chunks).toString('utf8').trim().split('\r\n');
  expect(lines[0]).toContain('melhor_referencia');
  expect(lines.length).toBeGreaterThan(1);
});

test('comparação sincroniza a URL e conta fatias separadas', async ({ page }) => {
  await page.goto('/comparar/');
  test.skip((await page.locator('[data-compare]').count()) === 0, 'Menos de duas execuções');
  await page.locator('[data-pick="b"] .select-trigger').click();
  await page.keyboard.type('BM25');
  await page.keyboard.press('Enter');
  const url = new URL(page.url());
  expect(url.searchParams.get('a')).not.toBe(url.searchParams.get('b'));
  await expect(page.locator('[data-verdicts] .tug-n')).toHaveCount(3);
  await page.getByRole('button', { name: 'Trocar as execuções de lado' }).click();
  const swapped = new URL(page.url());
  expect(swapped.searchParams.get('a')).toBe(url.searchParams.get('b'));
});

test('explorador filtra, navega por teclado e abre item por link', async ({ page }) => {
  await page.goto('/explorador/?track=A');
  await expect(page.locator('.ex-row').first()).toBeVisible();
  await expect(page.locator('[data-count]')).toContainText('de');
  await page.keyboard.press('j');
  await expect(page.locator('.ex-detail .ex-h')).toBeVisible();
  const id = new URL(page.url()).searchParams.get('item');
  expect(id).toBeTruthy();
  await page.goto(`/explorador/?item=${id}`);
  await expect(page.locator(`#row-${id}`)).toHaveAttribute('aria-selected', 'true');
  await page.getByRole('radio', { name: 'JSON' }).click();
  await expect(page.locator('.ex-json')).toContainText(id!);
});

test('busca rápida encontra tarefas e itens', async ({ page }) => {
  await page.goto('/');
  await page.keyboard.press('Control+k');
  await page.keyboard.type('quorum');
  await expect(page.locator('.cmdk-item').first()).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('.cmdk')).toHaveCount(0);
});

test('desafio termina sem persistir respostas', async ({ page }) => {
  await page.goto('/desafio/');
  test.skip((await page.locator('[data-quiz]').count()) === 0, 'Sem conjunto local');
  const total = await page.locator('.quiz-steps i').count();
  await page.getByRole('button', { name: /Conferir/ }).click();
  await expect(page.locator('.verdict')).toHaveCount(0);
  for (let n = 0; n < total; n++) {
    const tags = page.locator('.tag-input input');
    if (await tags.count()) {
      await tags.fill('resposta de teste');
      await tags.press('Enter');
    } else await page.locator('#quiz-answer').fill('7');
    await page.getByRole('button', { name: /Conferir/ }).click();
    await expect(page.locator('.verdict a')).toBeVisible();
    await page.getByRole('button', { name: /Próxima|Ver resultado/ }).click();
  }
  await expect(page.locator('.result-dots i')).toHaveCount(total);
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


test('nenhuma página rola sozinha ao abrir', async ({ page }) => {
  test.setTimeout(120000);
  const ids = await (await page.request.get('/itens/index.json')).json();
  for (const url of ['/', '/modelos/', '/comparar/', '/explorador/', `/explorador/?item=${ids[ids.length - 1].id}`, '/desafio/', '/trilhas/', '/trilhas/a/', '/metodologia/']) {
    await page.goto(url);
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(300);
    expect(await page.evaluate(() => scrollY), url).toBe(0);
  }
});

test('matriz mostra no máximo sete execuções e filtra por provedor', async ({ page }) => {
  await page.goto('/');
  const visible = page.locator('.matrix thead th.col:not(.off)');
  expect(await visible.count()).toBeLessThanOrEqual(7);
  expect(await visible.count()).toBeGreaterThan(0);
  await page.locator('[data-pick-runs] .select-trigger').click();
  await expect(page.locator('[data-pick-runs] .opt[aria-disabled="true"]').first()).toBeVisible();
});

test('lente da navegação acompanha o gatilho aberto', async ({ page, viewport }) => {
  test.skip((viewport?.width ?? 0) < 960, 'Navegação de desktop');
  await page.goto('/');
  const trigger = page.locator('[data-nav-trigger="metodo"]');
  await trigger.hover();
  await expect(page.locator('#nav-panel-metodo')).toBeVisible();
  await page.waitForTimeout(450);
  const lens = await page.locator('.nav-lens').boundingBox();
  const box = await trigger.boundingBox();
  expect(Math.abs(lens!.x - box!.x)).toBeLessThan(3);
});
