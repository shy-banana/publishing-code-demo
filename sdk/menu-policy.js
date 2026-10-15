import { constants, closeSync, fstatSync, lstatSync, openSync, readFileSync } from 'node:fs';
import { basename, dirname } from 'node:path';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const ID = /^[A-Za-z][A-Za-z0-9_.:-]{0,63}$/;
const METHOD = new Set(['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS']);
const COMMON_STATIC = new Set(['/', '/index.html', '/favicon.ico', '/robots.txt', '/manifest.json', '/manifest.webmanifest',
  '/assets/*', '/static/*', '/_next/static/*']);
const COMMON_AUTH = new Set(['/auth/login', '/auth/callback', '/auth/me']);
const MAX_BYTES = 1024 * 1024;

function invalid() { throw new Error('menu_access_configuration_invalid'); }
function object(value) { return value !== null && typeof value === 'object' && !Array.isArray(value); }
function keys(value, allowed) { if (!object(value) || Object.keys(value).some(key => !allowed.includes(key))) invalid(); }
function text(value, max = 128) { return typeof value === 'string' && value.length > 0 && value.length <= max && !/[\x00-\x1f\x7f]/.test(value); }
function ids(value) {
  if (!Array.isArray(value) || value.some(id => typeof id !== 'string' || !ID.test(id)) || new Set(value).size !== value.length) invalid();
  return [...value];
}
function identity(value) {
  if (!object(value) || !UUID.test(value.sub) || !text(value.corpId) || !text(value.wecomUserId) ||
      Buffer.byteLength(value.corpId) > 128 || Buffer.byteLength(value.wecomUserId) > 64 || /\s/.test(value.corpId + value.wecomUserId)) invalid();
  return { sub: value.sub, corpId: value.corpId.toLowerCase(), wecomUserId: value.wecomUserId.toLowerCase() };
}
function sameIdentity(user, member) {
  return user?.sub === member.sub && typeof user?.corp_id === 'string' && user.corp_id.toLowerCase() === member.corpId && typeof user?.wecom_userid === 'string' &&
    user.wecom_userid.toLowerCase() === member.wecomUserId;
}
function sameCompany(user, owner) {
  return typeof user?.sub === 'string' && UUID.test(user.sub) && text(user?.corp_id) && text(user?.wecom_userid) &&
    Buffer.byteLength(user.corp_id) <= 128 && Buffer.byteLength(user.wecom_userid) <= 64 &&
    !/\s/.test(user.corp_id + user.wecom_userid) && user.corp_id.toLowerCase() === owner.corpId;
}

// Validate the raw request target before URL parsing can normalize dot segments.
// A single canonical decoded path is used for both route checks and ambiguity
// prevention; encoded separators and a second decoding step are never accepted.
export function normalizeRequestPath(target) {
  if (typeof target !== 'string' || !target.startsWith('/') || target.startsWith('//') || target.length > 8192 ||
      /[\\\x00-\x1f\x7f#]/.test(target)) throw new Error('request_invalid');
  const raw = target.split('?', 1)[0];
  if (/%(?:2f|5c)/i.test(raw)) throw new Error('request_invalid');
  let path;
  try { path = decodeURIComponent(raw); } catch { throw new Error('request_invalid'); }
  if (/[\\\x00-\x1f\x7f%?#]/.test(path) || path.includes('//') ||
      path.split('/').some(part => part === '.' || part === '..')) throw new Error('request_invalid');
  return path;
}

function parts(path) { return path === '/' ? [] : path.slice(1).split('/'); }
function validatePath(path) {
  if (typeof path !== 'string' || path.length > 200 || path.includes('?') || path.includes('#') || path.includes('%') || /[^\x21-\x7e]/.test(path)) invalid();
  if (path === '/_platform' || path.startsWith('/_platform/')) invalid();
  try { if (normalizeRequestPath(path) !== path) invalid(); } catch { invalid(); }
  const segments = parts(path), parameters = new Set();
  for (let i = 0; i < segments.length; i += 1) {
    const segment = segments[i];
    if (!segment) invalid();
    if (segment === '*') { if (i !== segments.length - 1 || i === 0) invalid(); continue; }
    if (segment.startsWith(':')) {
      if (!/^:[A-Za-z][A-Za-z0-9_]{0,63}$/.test(segment) || parameters.has(segment)) invalid();
      parameters.add(segment);
    } else if (segment.includes('*') || segment.includes(':')) invalid();
  }
  return path;
}
function overlaps(left, right) {
  const a = parts(left), b = parts(right);
  for (let i = 0; ; i += 1) {
    if (a[i] === '*' || b[i] === '*') return true;
    if (i === a.length || i === b.length) return i === a.length && i === b.length;
    if (!a[i].startsWith(':') && !b[i].startsWith(':') && a[i] !== b[i]) return false;
  }
}
function matches(pattern, path) {
  const a = parts(pattern), b = parts(path);
  for (let i = 0; ; i += 1) {
    if (a[i] === '*') return true;
    if (i === a.length || i === b.length) return i === a.length && i === b.length;
    if (!b[i] || (!a[i].startsWith(':') && a[i] !== b[i])) return false;
  }
}
function route(value, menuSet, common = false) {
  keys(value, common ? ['methods', 'path'] : ['methods', 'path', 'menuIds']);
  if (!Array.isArray(value.methods) || !value.methods.length || value.methods.some(method => !METHOD.has(method)) ||
      new Set(value.methods).size !== value.methods.length) invalid();
  const path = validatePath(value.path);
  if (common && !((COMMON_STATIC.has(path) && value.methods.every(method => ['GET', 'HEAD'].includes(method))) ||
      (COMMON_AUTH.has(path) && value.methods.every(method => method === 'GET')) ||
      (path === '/auth/logout' && value.methods.every(method => method === 'POST')))) invalid();
  const menuIds = common ? [] : ids(value.menuIds);
  if (!common && (!menuIds.length || menuIds.some(id => !menuSet.has(id)))) invalid();
  return { methods: [...value.methods], path, ...(common ? {} : { menuIds }) };
}

export function validateCatalog(value) {
  keys(value, ['schemaVersion', 'menus', 'routes', 'commonRoutes']);
  if (value.schemaVersion !== 1 || !Array.isArray(value.menus) || value.menus.length < 1 || value.menus.length > 64 ||
      !Array.isArray(value.routes) || !Array.isArray(value.commonRoutes) || value.routes.length + value.commonRoutes.length > 256) invalid();
  const menuSet = new Set();
  const menus = value.menus.map(menu => {
    keys(menu, ['id', 'name']);
    if (typeof menu.id !== 'string' || !ID.test(menu.id) || !text(menu.name, 80) || !menu.name.trim() || menuSet.has(menu.id)) invalid();
    menuSet.add(menu.id);
    return { id: menu.id, name: menu.name };
  });
  const routes = value.routes.map(value => route(value, menuSet));
  const commonRoutes = value.commonRoutes.map(value => route(value, menuSet, true));
  const combined = [...routes, ...commonRoutes];
  for (let i = 0; i < combined.length; i += 1) {
    for (let j = 0; j < i; j += 1) {
      if (combined[i].methods.some(method => combined[j].methods.includes(method)) && overlaps(combined[i].path, combined[j].path)) invalid();
    }
  }
  return { schemaVersion: 1, menus, routes, commonRoutes };
}

export function validateMenuAccess(value, appId) {
  keys(value, ['schemaVersion', 'appId', 'owner', 'manager', 'grantableMenuIds', 'revision', 'catalog', 'grants', 'audit', 'requests', 'knownMenuIds', 'retiredMenuIds', 'accessMode']);
  const accessMode = value.accessMode === undefined ? 'restricted' : value.accessMode;
  if (!['company', 'restricted'].includes(accessMode)) invalid();
  if (value.schemaVersion !== 1 || !UUID.test(value.appId) || (appId && value.appId !== appId) ||
      !Number.isSafeInteger(value.revision) || value.revision < 1 || !Array.isArray(value.grants) || value.grants.length > 1000 ||
      !Array.isArray(value.audit) || value.audit.length > 200 || !Array.isArray(value.requests) || value.requests.length > 100 ||
      value.audit.some(entry => !object(entry)) || value.requests.some(entry => !object(entry))) invalid();
  const catalog = validateCatalog(value.catalog), menuSet = new Set(catalog.menus.map(menu => menu.id));
  const knownMenuIds = value.knownMenuIds === undefined ? [...menuSet] : ids(value.knownMenuIds);
  const known = new Set(knownMenuIds);
  if (knownMenuIds.length > 4096 || [...menuSet].some(id => !known.has(id))) invalid();
  const grantableMenuIds = ids(value.grantableMenuIds);
  if (grantableMenuIds.length > 4096 || grantableMenuIds.some(id => !known.has(id))) invalid();
  const retiredMenuIds = value.retiredMenuIds === undefined ? [] : ids(value.retiredMenuIds);
  if (retiredMenuIds.length > 4096 || retiredMenuIds.some(id => !known.has(id))) invalid();
  const owner = identity(value.owner), manager = identity(value.manager);
  if (owner.corpId !== manager.corpId) invalid();
  const identities = new Set(), subjects = new Set();
  const grants = value.grants.map(grant => {
    keys(grant, ['sub', 'corpId', 'wecomUserId', 'name', 'menuIds']);
    const member = identity(grant), key = member.corpId + '\0' + member.wecomUserId;
    const menuIds = ids(grant.menuIds);
    if (typeof grant.name !== 'string' || grant.name.length > 120 || /[\x00-\x1f\x7f]/.test(grant.name) ||
        member.corpId !== owner.corpId || menuIds.length > 4096 || menuIds.some(id => !known.has(id)) || identities.has(key) || subjects.has(member.sub)) invalid();
    identities.add(key); subjects.add(member.sub);
    return { ...member, name: grant.name, menuIds };
  });
  return { schemaVersion: 1, appId: value.appId, owner, manager, accessMode,
    grantableMenuIds, revision: value.revision, catalog, grants, audit: value.audit, requests: value.requests, knownMenuIds, retiredMenuIds };
}

export class MenuPolicy {
  constructor(path, { appId, expectedUid = 1000, expectedCatalog } = {}) {
    if (typeof path !== 'string' || basename(path) !== 'menu-access.json' || !UUID.test(appId) || !Number.isInteger(expectedUid) || expectedUid < 0) invalid();
    this.path = path; this.appId = appId; this.expectedUid = expectedUid;
    this.expectedCatalog = expectedCatalog === undefined ? null : JSON.stringify(validateCatalog(expectedCatalog));
  }
  read() {
    const directory = lstatSync(dirname(this.path));
    if (!directory.isDirectory() || directory.isSymbolicLink() || directory.uid !== this.expectedUid || (directory.mode & 0o777) !== 0o700) invalid();
    let fd;
    try {
      fd = openSync(this.path, constants.O_RDONLY | constants.O_NOFOLLOW);
      const before = fstatSync(fd);
      if (!before.isFile() || before.nlink !== 1 || before.uid !== this.expectedUid || (before.mode & 0o777) !== 0o600 || before.size > MAX_BYTES) invalid();
      const raw = readFileSync(fd, 'utf8'), after = fstatSync(fd);
      if (Buffer.byteLength(raw) > MAX_BYTES || before.size !== after.size || before.mtimeMs !== after.mtimeMs || before.ctimeMs !== after.ctimeMs) invalid();
      const document = validateMenuAccess(JSON.parse(raw), this.appId);
      if (this.expectedCatalog !== null && JSON.stringify(document.catalog) !== this.expectedCatalog) invalid();
      return document;
    } catch { invalid(); } finally { if (fd !== undefined) closeSync(fd); }
  }
  owner() { const member = this.read().owner; return { sub: member.sub, corp_id: member.corpId, wecom_userid: member.wecomUserId }; }
  currentMenus(user, document = this.read()) {
    if (document.accessMode === 'company') return sameCompany(user, document.owner) ? document.catalog.menus : [];
    if (sameIdentity(user, document.owner)) return document.catalog.menus;
    const member = document.grants.find(member => sameIdentity(user, member));
    const allowed = new Set(member?.menuIds.filter(id => document.grantableMenuIds.includes(id)) || []);
    return document.catalog.menus.filter(menu => allowed.has(menu.id));
  }
  permits(user, document = this.read()) { return sameIdentity(user, document.owner) || this.currentMenus(user, document).length > 0; }
  permissions(user, document = this.read()) {
    const menus = this.currentMenus(user, document);
    return { appId: document.appId, revision: document.revision, menuIds: menus.map(menu => menu.id), menus };
  }
  evaluate(user, method, path) {
    const document = this.read(), permissions = this.permissions(user, document);
    if (!this.permits(user, document)) return { allowed: false, permissions, menuIds: [] };
    const common = document.catalog.commonRoutes.find(route => route.methods.includes(method) && matches(route.path, path));
    if (common) return { allowed: true, permissions, menuIds: [] };
    const route = document.catalog.routes.find(route => route.methods.includes(method) && matches(route.path, path));
    return { allowed: Boolean(route && route.menuIds.some(id => permissions.menuIds.includes(id))), permissions, menuIds: route?.menuIds || [] };
  }
}
