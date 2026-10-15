import http from 'node:http';
import { readFileSync } from 'node:fs';
import pg from 'pg';
import { MenuPolicy, validateCatalog } from './sdk/menu-policy.js';
import { createApp } from './src/app.mjs';

function required(name) {
  const value = process.env[name];
  if (typeof value !== 'string' || !value.trim()) throw new Error('configuration_missing');
  return value;
}

try {
  const catalog = validateCatalog(JSON.parse(readFileSync(new URL('./banana-permissions.json', import.meta.url), 'utf8')));
  const menuPolicy = new MenuPolicy(required('MENU_ACCESS_CONFIG_PATH'), {
    appId: required('MENU_APP_ID'), expectedCatalog: catalog,
  });
  menuPolicy.read();
  const pool = new pg.Pool({ connectionString: required('DATABASE_URL'), max: 3,
    ssl: { rejectUnauthorized: true, ca: readFileSync(required('PG_CA_CERT_PATH'), 'utf8') } });
  const app = createApp({ pool, menuPolicy, appOrigin: required('APP_ORIGIN') });
  const server = http.createServer({ requestTimeout: 30000, headersTimeout: 15000 }, app);
  server.listen(Number(process.env.PORT || 3000), '0.0.0.0');
  const close = () => server.close(() => pool.end());
  process.once('SIGTERM', close); process.once('SIGINT', close);
} catch {
  console.error('应用启动失败：请核对菜单策略、平台应用编号、HTTPS 来源及数据库配置。');
  process.exitCode = 1;
}
