import { after, before, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, chmod } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fixture, actors } from './fixture.mjs';
let f;
before(async () => { f = await fixture(); });
after(async () => { await f?.close(); });
beforeEach(async () => { await f.reset(); });

test('真实HTTP：两个菜单的页面、接口和公共壳分别允许或拒绝', async () => {
  assert.equal((await f.request(undefined, '/')).status, 401);
  assert.equal((await f.request('denied', '/')).status, 403);
  for (const route of ['/', '/index.html', '/assets/app.js', '/checks', '/api/checks']) assert.equal((await f.request('a', route)).status, 200, route);
  for (const route of ['/reports', '/api/reports']) assert.equal((await f.request('a', route)).status, 403, route);
  assert.equal((await f.request('b', '/reports')).status, 200);
  assert.equal((await f.request('b', '/api/reports')).status, 200);
  assert.equal((await f.request('b', '/checks')).status, 403);
  assert.equal((await f.request('b', '/api/checks', { method: 'POST', body: { title: '无权保存' } })).status, 403);
  assert.equal((await f.request('a', '/api/checks', { headers: { 'x-banana-corp-id': 'wrong-corp' } })).status, 403);
  assert.equal((await f.request('a', '/api/reports', { method: 'POST', body: {} })).status, 403);
});

test('真实PostgreSQL：保存及查询只取本人，菜单管理员也无全员业务数据特权', async () => {
  const a = await f.request('a', '/api/checks', { method: 'POST', body: { title: '甲的记录' } });
  const c = await f.request('c', '/api/checks', { method: 'POST', body: { title: '丙的记录' } });
  assert.equal(a.status, 201); assert.equal(c.status, 201);
  assert.deepEqual((await f.request('a', '/api/checks')).data.records.map(row => row.title), ['甲的记录']);
  assert.deepEqual((await f.request('c', '/api/checks')).data.records.map(row => row.title), ['丙的记录']);
  assert.equal((await f.request('c', '/api/reports')).data.summary.count, 1);
  assert.equal((await f.request('b', '/api/reports')).data.summary.count, 0);
  assert.equal((await f.request('owner', '/api/reports')).data.summary.count, 0);
  const saved = await f.pool.query('SELECT created_by FROM publishing_checks WHERE id=$1', [a.data.record.id]);
  assert.equal(saved.rows[0].created_by, actors.a.sub);
  const moved = structuredClone(f.document); moved.grants.find(g => g.sub === actors.a.sub).menuIds.push('reports'); moved.revision += 1;
  await f.writePolicy(moved);
  assert.equal((await f.request('a', '/api/reports')).data.summary.count, 1);
});

test('拒绝客户端createdBy、他人范围、跨站及非法输入，不产生记录', async () => {
  for (const body of [{ title: '伪造', createdBy: actors.c.sub }, { title: '' }, { title: 'a'.repeat(121) }, { title: '<script>测试文字</script>', sub: actors.c.sub }]) assert.equal((await f.request('a', '/api/checks', { method: 'POST', body })).status, 400);
  assert.equal((await f.request('a', '/api/checks?createdBy=' + actors.c.sub)).status, 400);
  assert.equal((await f.request('c', '/api/reports?sub=' + actors.a.sub)).status, 400);
  assert.equal((await f.request('a', '/api/checks', { method: 'POST', body: { title: '跨站' }, headers: { Origin: 'https://outside.example' } })).status, 403);
  assert.equal((await f.request('a', '/api/checks', { method: 'POST', body: 'invalid' })).status, 400);
  assert.equal((await f.request('a', '/api/checks', { method: 'POST', body: { title: 'a'.repeat(3000) } })).status, 413);
  assert.equal((await f.pool.query('SELECT count(*)::int AS n FROM publishing_checks')).rows[0].n, 0);
});

test('原会话身份撤权后立即拒绝，策略错误/目录不匹配/文件权限异常均拒绝', async () => {
  const next = structuredClone(f.document); next.grants = next.grants.filter(g => g.sub !== actors.a.sub); next.revision += 1;
  await f.writePolicy(next);
  assert.equal((await f.request('a', '/checks')).status, 403);
  assert.equal((await f.request('a', '/api/checks')).status, 403);
  assert.equal((await f.request('a', '/api/checks', { method: 'POST', body: { title: '旧会话重放' } })).status, 403);
  await f.writePolicy({ ...f.document, appId: '40000000-0000-4000-8000-000000000001' });
  assert.equal((await f.request('a', '/api/checks')).status, 503);
  const wrongCatalog = structuredClone(f.document); wrongCatalog.catalog.menus[0].name = '不属于此版本'; await f.writePolicy(wrongCatalog);
  assert.equal((await f.request('a', '/api/checks')).status, 503);
  await f.writePolicy(f.document); await chmod(f.menuPath, 0o644);
  assert.equal((await f.request('a', '/api/checks')).status, 503);
  await chmod(f.menuPath, 0o600);
});

test('缺少生产菜单配置拒绝启动；固定组件哈希及Node运行契约保持', async () => {
  const env = { ...process.env, NODE_ENV: 'production' }; delete env.MENU_ACCESS_CONFIG_PATH; delete env.MENU_APP_ID;
  const result = spawnSync(process.execPath, ['server.mjs'], { cwd: new URL('../', import.meta.url), env, encoding: 'utf8' });
  assert.equal(result.status, 1); assert.match(result.stderr, /应用启动失败/);
  const upstream = JSON.parse(await readFile(new URL('../sdk/UPSTREAM.json', import.meta.url), 'utf8'));
  assert.equal(createHash('sha256').update(await readFile(new URL('../sdk/menu-policy.js', import.meta.url))).digest('hex'), upstream.files['menu-policy.js']);
  const config = JSON.parse(await readFile(new URL('../publish.config.json', import.meta.url), 'utf8'));
  assert.deepEqual(config, { runtime: 'node', port: 3000, readinessPath: '/readyz', initialSql: 'database/001-initial.sql', nativeOidc: false });
});
