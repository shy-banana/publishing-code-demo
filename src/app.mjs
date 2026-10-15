import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { normalizeRequestPath } from '../sdk/menu-policy.js';

const files = new Map([
  ['/', { data: readFileSync(new URL('../web/index.html', import.meta.url)), type: 'text/html; charset=utf-8' }],
  ['/assets/app.js', { data: readFileSync(new URL('../web/app.js', import.meta.url)), type: 'text/javascript; charset=utf-8' }],
  ['/assets/style.css', { data: readFileSync(new URL('../web/style.css', import.meta.url)), type: 'text/css; charset=utf-8' }],
]);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
class RequestError extends Error {
  constructor(status, code, message) { super(message); this.status = status; this.code = code; }
}
const json = (res, status, value) => {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(value));
};
function gatewayUser(req) {
  // Trusted only on the private gateway -> runtime network. The gateway strips
  // incoming identity headers and injects its verified employee.
  const user = { sub: req.headers['x-banana-user-sub'], corp_id: req.headers['x-banana-corp-id'], wecom_userid: req.headers['x-banana-wecom-userid'] };
  if (!UUID.test(user.sub) || ![user.corp_id, user.wecom_userid].every(value => typeof value === 'string' && value.length > 0 && value.length <= 128 && !/[\x00-\x20\x7f,]/.test(value))) {
    throw new RequestError(401, 'not_authenticated', '请通过应用中心完成公司登录。');
  }
  return user;
}
async function readTitle(req) {
  if (!/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(req.headers['content-type'] || '')) throw new RequestError(415, 'invalid_content_type', '请使用 JSON 提交。');
  if (req.headers['content-encoding'] && req.headers['content-encoding'] !== 'identity') throw new RequestError(415, 'invalid_content_type', '不支持压缩提交。');
  const chunks = []; let size = 0;
  for await (const chunk of req.iterator({ destroyOnReturn: false })) {
    size += chunk.length;
    if (size > 2048) { req.resume(); throw new RequestError(413, 'too_large', '提交内容过长。'); }
    chunks.push(chunk);
  }
  let body;
  try { body = JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { throw new RequestError(400, 'invalid_json', '提交内容格式错误。'); }
  if (!body || Array.isArray(body) || typeof body !== 'object' || Object.keys(body).some(key => key !== 'title') || typeof body.title !== 'string' || !body.title.trim() || body.title.length > 120 || /[\x00-\x1f\x7f]/.test(body.title)) {
    throw new RequestError(400, 'invalid_title', '请填写 1–120 字的验收记录，不能提交账号或其他字段。');
  }
  return body.title.trim();
}

export function createApp({ pool, menuPolicy, appOrigin }) {
  if (!pool?.query || !menuPolicy?.evaluate) throw new TypeError('pool and menuPolicy are required');
  const origin = new URL(appOrigin).origin;
  return async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'");
    try {
      const pathname = normalizeRequestPath(req.url);
      if (pathname === '/readyz') {
        if (req.method !== 'GET') throw new RequestError(405, 'method_not_allowed', '不支持此操作。');
        await pool.query('SELECT 1'); return json(res, 200, { status: 'ready' });
      }
      const user = gatewayUser(req);
      let decision;
      try { decision = menuPolicy.evaluate(user, req.method, pathname); }
      catch { throw new RequestError(503, 'menu_authorization_unavailable', '菜单权限暂不可用，请稍后重试。'); }
      if (!decision.allowed) throw new RequestError(403, 'menu_access_denied', '你没有此菜单的使用权限，请联系应用负责人。');
      const url = new URL(req.url, origin);
      if (pathname === '/api/checks' && req.method === 'GET') {
        if ([...url.searchParams.keys()].some(key => key !== 'keyword') || url.searchParams.getAll('keyword').length > 1) throw new RequestError(400, 'invalid_query', '查询条件无效。');
        const keyword = url.searchParams.get('keyword') || '';
        if (keyword.length > 100 || /[\x00-\x1f\x7f]/.test(keyword)) throw new RequestError(400, 'invalid_query', '查询条件过长或无效。');
        const escaped = keyword.replace(/[\\%_]/g, '\\$&');
        const { rows } = await pool.query("SELECT id,title,created_at FROM publishing_checks WHERE created_by=$1 AND title ILIKE $2 ESCAPE '\\' ORDER BY created_at DESC,id LIMIT 100", [user.sub, '%' + escaped + '%']);
        return json(res, 200, { records: rows });
      }
      if (pathname === '/api/checks' && req.method === 'POST') {
        if (req.headers.origin !== origin || req.headers['sec-fetch-site'] === 'cross-site') throw new RequestError(403, 'invalid_origin', '请求来源校验失败，请从应用页面重新提交。');
        const title = await readTitle(req);
        const { rows } = await pool.query('INSERT INTO publishing_checks(id,title,created_by) VALUES($1,$2,$3) RETURNING id,title,created_at', [randomUUID(), title, user.sub]);
        return json(res, 201, { record: rows[0] });
      }
      if (pathname === '/api/reports' && req.method === 'GET') {
        if ([...url.searchParams.keys()].length) throw new RequestError(400, 'invalid_query', '汇总不接受其他账号或查询范围。');
        const { rows } = await pool.query('SELECT count(*)::integer AS count,max(created_at) AS latest_created_at FROM publishing_checks WHERE created_by=$1', [user.sub]);
        return json(res, 200, { summary: rows[0] });
      }
      const file = files.get(['/', '/index.html', '/checks', '/reports'].includes(pathname) ? '/' : pathname);
      if (file && ['GET', 'HEAD'].includes(req.method)) {
        res.writeHead(200, { 'Content-Type': file.type, 'Content-Length': file.data.length });
        return res.end(req.method === 'HEAD' ? undefined : file.data);
      }
      throw new RequestError(404, 'not_found', '页面或接口不存在。');
    } catch (error) {
      if (error?.message === 'request_invalid') return json(res, 400, { error: 'invalid_request', message: '请求地址无效。' });
      json(res, error instanceof RequestError ? error.status : 503, {
        error: error instanceof RequestError ? error.code : 'temporarily_unavailable',
        message: error instanceof RequestError ? error.message : '应用暂不可用，请稍后重试。',
      });
    }
  };
}
