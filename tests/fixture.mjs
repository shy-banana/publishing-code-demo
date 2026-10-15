import http from 'node:http';
import net from 'node:net';
import { mkdtemp, readFile, writeFile, rename, rm, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { randomUUID, randomBytes } from 'node:crypto';
import EmbeddedPostgres from 'embedded-postgres';
import pg from 'pg';
import { MenuPolicy } from '../sdk/menu-policy.js';
import { createApp } from '../src/app.mjs';

export const actors = {
  a: { sub: '10000000-0000-4000-8000-000000000001', corp_id: 'test-corp', wecom_userid: 'test-a' },
  b: { sub: '10000000-0000-4000-8000-000000000002', corp_id: 'test-corp', wecom_userid: 'test-b' },
  c: { sub: '10000000-0000-4000-8000-000000000003', corp_id: 'test-corp', wecom_userid: 'test-c' },
  denied: { sub: '10000000-0000-4000-8000-000000000004', corp_id: 'test-corp', wecom_userid: 'test-denied' },
  owner: { sub: '20000000-0000-4000-8000-000000000001', corp_id: 'test-corp', wecom_userid: 'test-owner' },
};
export function identityHeaders(actor) {
  const user = actors[actor];
  return user ? { 'x-banana-user-sub': user.sub, 'x-banana-corp-id': user.corp_id, 'x-banana-wecom-userid': user.wecom_userid } : {};
}
async function port() {
  const server = net.createServer(); await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const value = server.address().port; await new Promise(resolve => server.close(resolve)); return value;
}

// Only tests use synthetic gateway headers and a disposable local PostgreSQL.
// No test login or identity fallback is registered in the production server.
export async function fixture() {
  const dir = await mkdtemp(path.join(tmpdir(), 'banana-menu-acceptance-'));
  const dbPort = await port(), password = randomBytes(24).toString('base64url');
  const database = new EmbeddedPostgres({ databaseDir: path.join(dir, 'db'), port: dbPort, user: 'menu_test', password,
    persistent: false, authMethod: 'scram-sha-256', createPostgresUser: false, onLog: () => {}, onError: () => {} });
  await database.initialise(); await database.start(); await database.createDatabase('menu_test');
  const pool = new pg.Pool({ connectionString: `postgresql://menu_test:${password}@127.0.0.1:${dbPort}/menu_test`, ssl: false });
  await pool.query(await readFile(new URL('../database/001-initial.sql', import.meta.url), 'utf8'));
  const catalog = JSON.parse(await readFile(new URL('../banana-permissions.json', import.meta.url), 'utf8'));
  const menuDir = path.join(dir, 'menu-policy'); await mkdir(menuDir, { mode: 0o700 });
  const menuPath = path.join(menuDir, 'menu-access.json'), appId = randomUUID();
  const owner = { sub: '20000000-0000-4000-8000-000000000001', corpId: 'test-corp', wecomUserId: 'test-owner' };
  const document = { schemaVersion: 1, appId, owner, manager: owner, revision: 1, catalog,
    grantableMenuIds: ['checks', 'reports'], knownMenuIds: ['checks', 'reports'], retiredMenuIds: [],
    grants: [['a', ['checks']], ['b', ['reports']], ['c', ['checks', 'reports']]].map(([id, menuIds]) => ({ sub: actors[id].sub, corpId: actors[id].corp_id, wecomUserId: actors[id].wecom_userid, name: '测试员工 ' + id, menuIds })), audit: [], requests: [] };
  await writeFile(menuPath, JSON.stringify(document), { mode: 0o600 });
  const policy = new MenuPolicy(menuPath, { appId, expectedUid: process.getuid(), expectedCatalog: catalog });
  let app;
  const server = http.createServer((req, res) => app(req, res));
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  app = createApp({ pool, menuPolicy: policy, appOrigin: origin });
  return { origin, pool, policy, document, menuPath,
    async reset() { await pool.query('DELETE FROM publishing_checks'); await this.writePolicy(document); },
    async writePolicy(next) { await writeFile(menuPath + '.next', JSON.stringify(next), { mode: 0o600 }); await rename(menuPath + '.next', menuPath); },
    async request(actor, route, { method = 'GET', body, headers = {} } = {}) {
      const response = await fetch(origin + route, { method, headers: { ...identityHeaders(actor), ...(body !== undefined ? { 'Content-Type': 'application/json', Origin: origin } : {}), ...headers }, ...(body !== undefined ? { body: typeof body === 'string' ? body : JSON.stringify(body) } : {}) });
      const text = await response.text(); let data; try { data = JSON.parse(text); } catch { data = text; }
      return { status: response.status, headers: response.headers, data };
    },
    async close() { await new Promise(resolve => server.close(resolve)); await pool.end(); await database.stop(); await rm(dir, { recursive: true, force: true }); },
  };
}
