import { after, before, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { chmod, mkdir } from 'node:fs/promises';
import { chromium } from 'playwright';
import { fixture, actors, identityHeaders } from './fixture.mjs';
let f, browser;
before(async () => { f = await fixture(); browser = await chromium.launch({ headless: true }); });
after(async () => { await browser?.close(); await f?.close(); });
beforeEach(async () => { await f.reset(); });

async function pageFor(actor) {
  const page = await browser.newPage({ extraHTTPHeaders: identityHeaders(actor), viewport: { width: 1024, height: 820 } });
  // Test-only substitute for the gateway-owned permissions endpoint. All business
  // requests still reach the real HTTP app, real policy file, and real PostgreSQL.
  await page.route('**/_platform/permissions', async route => {
    try {
      if (!f.policy.permits(actors[actor])) return route.fulfill({ status: 403, contentType: 'application/json', body: '{}' });
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(f.policy.permissions(actors[actor])) });
    } catch { await route.fulfill({ status: 503, contentType: 'application/json', body: '{}' }); }
  });
  return page;
}
async function loaded(page) { await page.locator('#status').filter({ hasText: '已按当前菜单权限载入本人数据' }).waitFor(); }

test('浏览器实际保存、刷新保留、仅显示获准菜单及旧链接拒绝', async () => {
  const page = await pageFor('a');
  try {
    await page.goto(f.origin + '/'); await loaded(page);
    assert.deepEqual(await page.locator('#menus a').allTextContents(), ['验收登记']);
    await page.getByLabel('验收记录', { exact: true }).fill('浏览器本人保存');
    await page.getByRole('button', { name: '保存记录', exact: true }).click();
    await page.getByText('记录已保存，刷新后仍可查看。', { exact: true }).waitFor();
    assert.match(await page.locator('#records').innerText(), /浏览器本人保存/);
    await page.reload(); await loaded(page);
    assert.match(await page.locator('#records').innerText(), /浏览器本人保存/);
    await mkdir('artifacts', { recursive: true }); await page.screenshot({ path: 'artifacts/checks-desktop.png', fullPage: true });
    await page.setViewportSize({ width: 320, height: 700 });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    const denied = await page.goto(f.origin + '/reports'); assert.equal(denied.status(), 403);
    assert.match(await page.locator('body').innerText(), /menu_access_denied/);
  } finally { await page.close(); }
});

test('浏览器双菜单与本人汇总；撤权和503均清除已载入内容', async () => {
  const page = await pageFor('c');
  try {
    await page.goto(f.origin + '/checks'); await loaded(page);
    assert.deepEqual(await page.locator('#menus a').allTextContents(), ['验收登记', '汇总查看']);
    await page.getByLabel('验收记录', { exact: true }).fill('丙的浏览器记录'); await page.getByRole('button', { name: '保存记录', exact: true }).click();
    await page.getByText('记录已保存，刷新后仍可查看。', { exact: true }).waitFor();
    await page.getByRole('link', { name: '汇总查看', exact: true }).click(); await loaded(page);
    assert.equal(await page.locator('#count').innerText(), '1');
    await page.goto(f.origin + '/checks'); await loaded(page);
    const next = structuredClone(f.document); next.grants.find(g => g.sub === actors.c.sub).menuIds = ['reports']; next.revision += 1; await f.writePolicy(next);
    await page.getByRole('button', { name: '重新检查权限', exact: true }).click();
    await page.getByRole('alert').filter({ hasText: '使用权已变化' }).waitFor();
    assert.equal(await page.locator('#records').innerText(), ''); assert.equal(await page.locator('#checks').isHidden(), true); assert.equal(await page.locator('#menus a').count(), 0);
    await f.writePolicy(f.document); await page.goto(f.origin + '/checks'); await loaded(page);
    await chmod(f.menuPath, 0o644); await page.getByRole('button', { name: '重新检查权限', exact: true }).click();
    await page.getByRole('alert').filter({ hasText: '已清除本页数据' }).waitFor();
    assert.equal(await page.locator('#records').innerText(), ''); assert.equal(await page.locator('#checks').isHidden(), true);
    await chmod(f.menuPath, 0o600);
  } finally { await page.close(); }
});
