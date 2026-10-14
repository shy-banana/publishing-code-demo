import http, { type ServerResponse } from 'node:http';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import pg from 'pg';

const release = 'typescript-node-v1';
const identity = { release, language: 'TypeScript', framework: 'Node.js HTTP' };
const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
let pool: pg.Pool | undefined;
function database(): pg.Pool {
  if (!pool) {
    const connectionString = process.env.DATABASE_URL;
    const certificate = process.env.PG_CA_CERT_PATH;
    if (!connectionString || !certificate) throw new Error('database_not_configured');
    pool = new pg.Pool({ connectionString, max: 3, connectionTimeoutMillis: 5000,
      ssl: { rejectUnauthorized: true, ca: readFileSync(certificate, 'utf8') } });
  }
  return pool;
}
function json(res: ServerResponse, status: number, value: unknown): void {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(value));
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url || '/', 'http://app');
    if ((url.pathname === '/readyz' || url.pathname === '/healthz') && req.method === 'GET') {
      try {
        const client = await database().connect();
        try {
          const session = (await client.query('SELECT current_user AS role, pg_backend_pid() AS pid')).rows[0];
          const tls = (await client.query('SELECT ssl FROM pg_stat_ssl WHERE pid = $1', [session.pid])).rows[0];
          const count = (await client.query('SELECT count(*) AS count FROM publishing_checks')).rows[0];
          if (!session.role || !tls?.ssl) throw new Error('database_tls_required');
          return json(res, 200, { ...identity, status: 'ready', databaseTls: true, recordCount: Number(count.count) });
        } finally { client.release(); }
      } catch {
        return json(res, 503, { ...identity, status: 'unavailable' });
      }
    }
    if (url.pathname === '/api/release' && req.method === 'GET') {
      return json(res, 200, { ...identity, commitSha: process.env.SOURCE_COMMIT_SHA || null });
    }
    if (url.pathname === '/api/checks' && req.method === 'GET') {
      const keyword = (url.searchParams.get('keyword') || '').slice(0, 100);
      const { rows } = await database().query(
        'SELECT id,title,created_at FROM publishing_checks WHERE title ILIKE $1 ORDER BY created_at DESC LIMIT 100',
        ['%' + keyword + '%']);
      return json(res, 200, { ...identity, count: rows.length, keyword, records: rows });
    }
    if (url.pathname === '/api/checks' && req.method === 'POST') {
      if (!req.headers['content-type']?.startsWith('application/json')) {
        return json(res, 415, { error: 'json_required' });
      }
      let size = 0;
      const chunks: Buffer[] = [];
      for await (const chunk of req) {
        size += chunk.length;
        if (size > 2048) return json(res, 413, { error: 'too_large' });
        chunks.push(Buffer.from(chunk));
      }
      let body: unknown;
      try { body = JSON.parse(Buffer.concat(chunks).toString('utf8')); }
      catch { return json(res, 400, { error: 'invalid_json' }); }
      const title = body && typeof body === 'object' && 'title' in body ? body.title : null;
      if (typeof title !== 'string' || !title.trim() || title.length > 120) {
        return json(res, 400, { error: 'invalid_title' });
      }
      const { rows } = await database().query(
        'INSERT INTO publishing_checks(id,title) VALUES($1,$2) RETURNING id,title', [randomUUID(), title.trim()]);
      return json(res, 201, rows[0]);
    }
    if (url.pathname === '/' && req.method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
      return res.end(html);
    }
    json(res, 404, { error: 'not_found' });
  } catch { json(res, 503, { ...identity, error: 'temporarily_unavailable' }); }
});
server.listen(Number(process.env.PORT || 3000), '0.0.0.0');
function stop(): void {
  server.close(() => { void pool?.end().finally(() => process.exit(0)); if (!pool) process.exit(0); });
}
process.on('SIGTERM', stop);
process.on('SIGINT', stop);
