#!/usr/bin/env node
// 只读验证脚本：不写入凭据、令牌、GUID、coverId、内网地址或媒体内容。
// 用法（在仓库根目录执行）：
//   FNMUSIC_ORIGIN='http://<host>:<port>' \
//   FNMUSIC_USERNAME='<username>' \
//   FNMUSIC_PASSWORD='<password>' \
//   node tools/verify-readonly.mjs
// 可选：FNMUSIC_OUT='<file>.json'（相对当前工作目录，默认 readonly-results.json）

import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

const ORIGIN = (process.env.FNMUSIC_ORIGIN || '').replace(/\/+$/, '');
const USERNAME = process.env.FNMUSIC_USERNAME || '';
const PASSWORD = process.env.FNMUSIC_PASSWORD || '';
if (!ORIGIN || !USERNAME || !PASSWORD) {
  console.error('缺少 FNMUSIC_ORIGIN / FNMUSIC_USERNAME / FNMUSIC_PASSWORD');
  process.exit(2);
}
const BASE = ORIGIN + '/music/api/v1';
const OUT = process.env.FNMUSIC_OUT || 'readonly-results.json';
const startedAt = new Date().toISOString();

const ctx = {
  token: '',
  tokenLength: 0,
  trackGuid: '',
  albumGuid: '',
  artistGuid: '',
  playlistGuid: '',
  libraryGuid: '',
  coverId: '',
  keyword: 'a',
  defaultSort: '',
  fakeGuid: crypto.randomBytes(16).toString('hex'),
  authxValue: '',
  probeUsername: '__fnmusic_probe__',
  probeParent: '/',
  loggedOut: false,
};
ctx.authxValue = `nonce=123456&timestamp=${Date.now()}&sign=${crypto.createHash('md5').update('forged').digest('hex')}`;

const results = [];
const rawById = new Map();
const q = (v) => encodeURIComponent(String(v));
const short = (v) => String(v || '').split(';')[0].trim();
const keys = (o) => (o && typeof o === 'object' && !Array.isArray(o) ? Object.keys(o).join(',') : '');
const arrLen = (o, k) => (Array.isArray(o?.[k]) ? o[k].length : -1);
const numVal = (o, k) => (typeof o?.[k] === 'number' ? o[k] : 'n/a');
const hasKeys = (o, ks) => !!o && typeof o === 'object' && !Array.isArray(o) && ks.every((k) => k in o);
const isJsonSuccess = (r) =>
  r.httpStatus === 200 && r.contentType.includes('application/json') && r.json?.code === 0;

function redactText(input) {
  let s = String(input ?? '');
  s = s.split(ORIGIN).join('<origin>');
  s = s.split(PASSWORD).join('<password>');
  s = s.split(USERNAME).join('<username>');
  s = s.replace(/\b(?:album|artist|track|playlist)_[0-9a-fA-F]{32}\b/g, '<coverId>');
  s = s.replace(/\b[0-9a-fA-F]{32}\b/g, '<id>');
  s = s.replace(/music-token=[^;\s]+/gi, 'music-token=<redacted>');
  s = s.replace(/\b(?:\d{1,3}\.){3}\d{1,3}\b/g, '<host>');
  return s.length > 300 ? s.slice(0, 297) + '...' : s;
}
const safeError = (e) => redactText(`request exception: ${e?.name || 'Error'}: ${e?.message || String(e)}`);

function summarize(value, depth = 0, key = '') {
  if (value === null) return null;
  if (value === undefined) return '<undefined>';
  if (Array.isArray(value)) {
    if (depth >= 4) return { __type: 'array', length: value.length, sample: '<max-depth>' };
    return { __type: 'array', length: value.length, sample: value.length ? summarize(value[0], depth + 1, key) : null };
  }
  if (typeof value === 'object') {
    if (depth >= 4) return '<max-depth>';
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, summarize(v, depth + 1, k)]));
  }
  if (typeof value === 'string') {
    if (key === 'msg') return value === '' ? '' : `<msg:${value.length}>`;
    if (['sort', 'role', 'serverVersion', 'mediasrvVersion', 'status', 'mode', 'metadataPreference'].includes(key)) return value;
    return `<str:${value.length}>`;
  }
  return value;
}

async function call(actualPath, opts = {}) {
  const url = opts.absolute ? new URL(actualPath, ORIGIN) : new URL(BASE + actualPath);
  const headers = { Accept: opts.accept || 'application/json', ...(opts.headers || {}) };
  if (opts.cookie !== false && ctx.token) headers.Cookie = `music-token=${ctx.token}`;
  if (opts.body !== undefined) headers['Content-Type'] = 'application/json';
  if (opts.range) headers.Range = opts.range;
  const res = await fetch(url, {
    method: opts.method || 'GET',
    headers,
    redirect: 'error',
    signal: AbortSignal.timeout(15000),
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
  });
  const buf = new Uint8Array(await res.arrayBuffer());
  const contentType = res.headers.get('content-type') || '';
  const safeHeaders = {};
  for (const k of ['content-type', 'cache-control', 'content-range', 'content-length', 'accept-ranges']) {
    const v = res.headers.get(k);
    if (v !== null) safeHeaders[k] = v;
  }
  let json = null;
  if (contentType.includes('application/json')) {
    try { json = JSON.parse(new TextDecoder('utf-8', { fatal: false }).decode(buf)); } catch { /* ignore */ }
  }
  let isHtml = false;
  if (!json) {
    const head = new TextDecoder('utf-8', { fatal: false }).decode(buf.subarray(0, 512));
    isHtml = /<(!doctype\s+)?html/i.test(head);
  }
  return {
    httpStatus: res.status,
    contentType,
    headers: safeHeaders,
    setCookiePresent: res.headers.get('set-cookie') !== null,
    json,
    bodyLength: buf.byteLength,
    isHtml,
  };
}

const A = {
  success: (extra = () => true, detail = () => '') => (r) => ({
    pass: isJsonSuccess(r) && !!extra(r),
    detail: `HTTP ${r.httpStatus}, code ${r.json?.code}; ${detail(r)}`,
  }),
  code: (code, status = 200, extra = () => true, detail = () => '') => (r) => ({
    pass: r.httpStatus === status && r.json?.code === code && !!extra(r),
    detail: `HTTP ${r.httpStatus}, code ${r.json?.code}; ${detail(r)}`,
  }),
  unauth: () => A.code(99999, 401, () => true, (r) => `contentType=${short(r.contentType)}`),
  admin: () => A.code(100003, 200, () => true, () => '成员权限被拒'),
  invalid: () => A.code(100002, 200, () => true, () => '缺参/非法参数'),
  notFound: () => A.code(100005, 200, () => true, () => '资源不存在'),
  http400: () => (r) => ({
    pass: r.httpStatus === 400 && !r.contentType.includes('application/json'),
    detail: `HTTP ${r.httpStatus}, contentType=${short(r.contentType)}, byteLength=${r.bodyLength}`,
  }),
  http404Text: () => (r) => ({
    pass: r.httpStatus === 404 && !r.contentType.includes('application/json') && r.bodyLength < 128,
    detail: `HTTP ${r.httpStatus}, contentType=${short(r.contentType)}, byteLength=${r.bodyLength}`,
  }),
  range: () => (r) => ({
    pass: r.httpStatus === 206 && short(r.contentType).startsWith('audio/') && r.bodyLength === 100 && !!r.headers['content-range'],
    detail: `HTTP ${r.httpStatus}, contentType=${short(r.contentType)}, byteLength=${r.bodyLength}, contentRange=${r.headers['content-range'] ? 'present' : 'absent'}`,
  }),
  image: () => (r) => ({
    pass: r.httpStatus === 200 && short(r.contentType).startsWith('image/') && r.bodyLength > 0,
    detail: `HTTP ${r.httpStatus}, contentType=${short(r.contentType)}, byteLength=${r.bodyLength}, cacheControl=${r.headers['cache-control'] || 'absent'}`,
  }),
  html: (extra = () => true) => (r) => ({
    pass: r.httpStatus === 200 && r.contentType.includes('text/html') && r.isHtml && !!extra(r),
    detail: `HTTP ${r.httpStatus}, contentType=${short(r.contentType)}, html=${r.isHtml}, cacheControl=${r.headers['cache-control'] || 'absent'}`,
  }),
  info: (detail = () => '') => (r) => ({
    pass: true,
    detail: `HTTP ${r.httpStatus}, code ${r.json?.code ?? 'n/a'}, contentType=${short(r.contentType)}; ${detail(r)}`,
  }),
  list: (ks = ['list', 'total']) => A.success(
    (r) => hasKeys(r.json?.data, ks) && Array.isArray(r.json?.data?.list),
    (r) => `list=${arrLen(r.json?.data, 'list')}, total=${numVal(r.json?.data, 'total')}, keys=[${keys(r.json?.data)}]`,
  ),
  listWithSort: () => A.success(
    (r) => hasKeys(r.json?.data, ['list', 'total', 'sort']) && Array.isArray(r.json?.data?.list),
    (r) => `list=${arrLen(r.json?.data, 'list')}, total=${numVal(r.json?.data, 'total')}, sort=${r.json?.data?.sort}, keys=[${keys(r.json?.data)}]`,
  ),
  object: (ks) => A.success(
    (r) => hasKeys(r.json?.data, ks),
    (r) => `keys=[${keys(r.json?.data)}]`,
  ),
  sortEcho: (expected) => A.success(
    (r) => r.json?.data?.sort === expected && hasKeys(r.json?.data, ['list', 'total', 'sort']) && Array.isArray(r.json?.data?.list),
    (r) => `sort=${r.json?.data?.sort}, expected=${expected}, list=${arrLen(r.json?.data, 'list')}`,
  ),
  invalidSortEcho: () => A.success(
    (r) => typeof r.json?.data?.sort === 'string' && r.json.data.sort !== '__not_a_field__,asc',
    (r) => `sort=${r.json?.data?.sort}`,
  ),
  pageCompare: (otherId) => (r) => {
    const a = rawById.get(otherId)?.json?.data;
    const b = r.json?.data;
    const sameTotal = a?.total === b?.total;
    const differentFirst = a?.list?.[0]?.guid !== b?.list?.[0]?.guid;
    const empty = a?.total === 0;
    return {
      pass: !!a && !!b && sameTotal && (empty || (a.list.length > 0 && differentFirst)),
      detail: `sameTotal=${sameTotal}, differentFirst=${differentFirst}, emptyLibrary=${empty}`,
    };
  },
  searchPageCompare: (otherId) => (r) => {
    const a = rawById.get(otherId)?.json?.data;
    const b = r.json?.data;
    const sameTotal = a?.total === b?.total;
    const sameFirst = a?.list?.[0]?.guid === b?.list?.[0]?.guid;
    const enough = (a?.total ?? 0) > 1;
    return {
      pass: !!a && !!b && sameTotal && (!enough || sameFirst),
      detail: `sameTotal=${sameTotal}, sameFirst=${sameFirst}, enoughSample=${enough}`,
    };
  },
  filterIgnored: (otherId) => (r) => {
    const a = rawById.get(otherId)?.json?.data;
    const b = r.json?.data;
    return {
      pass: !!a && !!b && a.total === b.total && a?.list?.[0]?.guid === b?.list?.[0]?.guid,
      detail: `sameTotal=${a?.total === b?.total}, sameFirst=${a?.list?.[0]?.guid === b?.list?.[0]?.guid}`,
    };
  },
  authxAccepted: () => (r) => {
    const base = rawById.get('track-list-default')?.json?.data;
    return {
      pass: isJsonSuccess(r) && r.json?.data?.total === base?.total,
      detail: `code=${r.json?.code}, totalMatchesBaseline=${r.json?.data?.total === base?.total}`,
    };
  },
  login: () => (r) => {
    const d = r.json?.data;
    const ok = isJsonSuccess(r) && typeof d?.userToken === 'string' && d.userToken.length === 32 && typeof d?.user?.guid === 'string' && d.user.guid.length === 32 && d.user.role === 'member' && !r.setCookiePresent;
    return {
      pass: ok,
      detail: `code=${r.json?.code}, tokenPresent=${typeof d?.userToken === 'string'}, tokenLength=${d?.userToken?.length ?? 0}, role=${d?.user?.role}, setCookiePresent=${r.setCookiePresent}`,
    };
  },
  logout: () => A.success((r) => r.json?.data === null, (r) => `data=${r.json?.data === null ? 'null' : typeof r.json?.data}`),
};

async function runCase(spec) {
  const base = {
    id: spec.id,
    group: spec.group,
    method: spec.method || 'GET',
    path: redactText(spec.display),
    expected: redactText(spec.expected || ''),
    observed: null,
    pass: null,
    informational: !!spec.informational,
    detail: '',
    note: redactText(spec.note || ''),
    skipped: false,
    error: null,
  };
  try {
    const rawPath = spec.path !== undefined ? spec.path : spec.display;
    const actualPath = typeof rawPath === 'function' ? rawPath(ctx) : rawPath;
    if (actualPath === null || actualPath === undefined) {
      results.push({ ...base, skipped: true, note: redactText(spec.skipReason || '依赖样本缺失，已跳过') });
      return null;
    }
    const opts = {
      method: spec.method || 'GET',
      cookie: spec.cookie !== false,
      accept: spec.accept,
      range: spec.range,
      absolute: !!spec.absolute,
      headers: spec.headers,
      body: typeof spec.body === 'function' ? spec.body(ctx) : spec.body,
    };
    const r = await call(actualPath, opts);
    rawById.set(spec.id, r);
    const a = spec.assert ? spec.assert(r, ctx) : { pass: true, detail: '已记录' };
    results.push({
      ...base,
      observed: {
        httpStatus: r.httpStatus,
        contentType: short(r.contentType),
        code: r.json?.code ?? null,
        msgPresent: !!(r.json && typeof r.json.msg === 'string' && r.json.msg.length > 0),
        dataShape: summarize(r.json?.data),
        headers: r.headers,
        byteLength: r.bodyLength,
        isHtml: r.isHtml,
        setCookiePresent: r.setCookiePresent,
      },
      pass: !!a.pass,
      detail: redactText(a.detail || ''),
    });
    return r;
  } catch (e) {
    results.push({ ...base, pass: false, error: safeError(e) });
    return null;
  }
}

// ---------- 1. 公开信息、SPA 与登录 ----------
await runCase({
  id: 'sys-config', group: '协议与系统', display: '/sys/config', cookie: false,
  expected: 'HTTP 200 / code 0；返回 serverVersion、mediasrvVersion、nasOAuth、capabilities',
  assert: A.success(
    (r) => typeof r.json?.data?.serverVersion === 'string' && typeof r.json?.data?.mediasrvVersion === 'string' && hasKeys(r.json?.data, ['nasOAuth', 'serverGUID', 'serverName', 'serverVersion', 'mediasrvVersion', 'capabilities']),
    (r) => `serverVersion=${r.json?.data?.serverVersion}, mediasrvVersion=${r.json?.data?.mediasrvVersion}, keys=[${keys(r.json?.data)}]`,
  ),
});
await runCase({
  id: 'initialization-state', group: '协议与系统', display: '/initialization/state', cookie: false,
  expected: 'HTTP 200 / code 0；data.initialized 为布尔值',
  assert: A.success((r) => typeof r.json?.data?.initialized === 'boolean', (r) => `initialized=${r.json?.data?.initialized}`),
});
await runCase({
  id: 'spa-root', group: '协议与系统', display: '/music/', absolute: true, cookie: false, accept: 'text/html',
  expected: 'HTTP 200 text/html；Cache-Control 含 no-cache/no-store',
  assert: A.html((r) => /no-cache|no-store/.test(r.headers['cache-control'] || '')),
});
await runCase({
  id: 'spa-fallback', group: '协议与系统', display: '/music/api/v1/<不存在的路径>',
  path: (c) => `/music/api/v1/__readonly_probe_${c.fakeGuid.slice(0, 8)}__`, absolute: true, cookie: false, accept: 'text/html',
  expected: 'HTTP 200 text/html；不存在路径命中 SPA 兜底而不是 JSON 成功',
  assert: A.html(),
  note: '仅校准兜底行为，不据此推断所有方法/前缀都未实现',
});
const loginRes = await runCase({
  id: 'login', group: '认证', method: 'POST', display: '/user/password-login', cookie: false,
  body: () => ({
    username: USERNAME,
    password: crypto.createHash('sha256').update(PASSWORD, 'utf8').digest('hex'),
    deviceId: crypto.randomBytes(16).toString('hex'),
  }),
  expected: 'HTTP 200 / code 0；返回 32 位 userToken 与 member 用户；无 Set-Cookie',
  assert: A.login(),
  note: '密码仅用于内存中的 SHA-256，凭据与令牌不写入结果',
});
ctx.token = loginRes?.json?.data?.userToken || '';
ctx.tokenLength = ctx.token.length;
await runCase({
  id: 'user-me', group: '认证', display: '/user/me',
  expected: 'HTTP 200 / code 0；返回当前 member 用户',
  assert: A.success((r) => hasKeys(r.json?.data, ['guid', 'name', 'role']) && r.json.data.role === 'member', (r) => `role=${r.json?.data?.role}, keys=[${keys(r.json?.data)}]`),
});
await runCase({
  id: 'sys-info', group: '协议与系统', display: '/sys/info',
  expected: 'HTTP 200 / code 0；data.connect 含 id/status/entitlement',
  assert: A.success((r) => hasKeys(r.json?.data, ['connect']) && r.json.data.connect && typeof r.json.data.connect === 'object', (r) => `connect keys=[${keys(r.json?.data?.connect)}], entitlementPresent=${'entitlement' in (r.json?.data?.connect || {})}`),
  note: '非前端注册表路径，文档已单列；只断言 connect 对象，子字段按实际回显记录',
});

// ---------- 2. 取样本 ID 的基础列表 ----------
await runCase({ id: 'track-list-default', group: '曲目', display: '/track/list?page=1&size=2', expected: 'HTTP 200 / code 0；{list,total,sort}', assert: A.listWithSort() });
await runCase({ id: 'album-list-default', group: '专辑', display: '/album/list?page=1&size=2', expected: 'HTTP 200 / code 0；{list,total,sort}', assert: A.listWithSort() });
await runCase({ id: 'artist-list-default', group: '艺术家', display: '/artist/list?page=1&size=2', expected: 'HTTP 200 / code 0；{list,total,sort}', assert: A.listWithSort() });
await runCase({ id: 'genre-list-default', group: '流派', display: '/genre/list?page=1&size=2', expected: 'HTTP 200 / code 0；{list,total,sort}', assert: A.listWithSort(), note: '空库也可成功' });
await runCase({ id: 'playlist-list-default', group: '歌单', display: '/playlist/list', expected: 'HTTP 200 / code 0；{list,total}', assert: A.list(), note: '分页未证实；记录实际字段' });
await runCase({ id: 'shared-library-list-default', group: '共享音乐库', display: '/shared-library/list', expected: 'HTTP 200 / code 0；{list}', assert: A.list(['list']) });
await runCase({ id: 'favorite-list-default', group: '收藏', display: '/favorite-track/list?page=1&size=2', expected: 'HTTP 200 / code 0；{list,total,sort}', assert: A.listWithSort(), note: '空列表也可成功' });
await runCase({ id: 'history-list-default', group: '播放历史', display: '/play-history/list?page=1&size=2', expected: 'HTTP 200 / code 0；{list,total}，无已确认 sort 回显', assert: A.list(), note: '记录 sort 是否出现，不强制要求' });
await runCase({ id: 'task-list-default', group: '任务', display: '/task/list', expected: 'HTTP 200 / code 0；{list}', assert: A.list(['list']) });

const trackSample = rawById.get('track-list-default')?.json?.data?.list || [];
const albumSample = rawById.get('album-list-default')?.json?.data?.list || [];
const artistSample = rawById.get('artist-list-default')?.json?.data?.list || [];
const playlistSample = rawById.get('playlist-list-default')?.json?.data?.list || [];
const librarySample = rawById.get('shared-library-list-default')?.json?.data?.list || [];
ctx.trackGuid = trackSample[0]?.guid || '';
ctx.albumGuid = albumSample[0]?.guid || '';
ctx.artistGuid = artistSample[0]?.guid || '';
ctx.playlistGuid = playlistSample[0]?.guid || '';
ctx.libraryGuid = librarySample[0]?.guid || '';
ctx.coverId = trackSample.find((t) => typeof t?.coverId === 'string' && t.coverId)?.coverId
  || albumSample.find((a) => typeof a?.coverId === 'string' && a.coverId)?.coverId || '';
ctx.keyword = Array.from(String(trackSample[0]?.title || '').trim())[0] || 'a';
ctx.defaultSort = rawById.get('track-list-default')?.json?.data?.sort || '';

// ---------- 3. 分页、过滤、authx ----------
await runCase({ id: 'track-list-page2', group: '分页排序', display: '/track/list?page=2&size=2', expected: 'page/size 改变返回页', assert: A.pageCompare('track-list-default') });
await runCase({ id: 'album-list-page2', group: '分页排序', display: '/album/list?page=2&size=2', expected: 'page/size 改变返回页', assert: A.pageCompare('album-list-default') });
await runCase({ id: 'artist-list-page2', group: '分页排序', display: '/artist/list?page=2&size=2', expected: 'page/size 改变返回页', assert: A.pageCompare('artist-list-default') });
await runCase({
  id: 'track-list-fake-artist-filter', group: '分页排序',
  display: '/track/list?page=1&size=2&artistGUID=<fakeGUID>',
  path: (c) => `/track/list?page=1&size=2&artistGUID=${q(c.fakeGuid)}`,
  expected: 'track/list 不应把 artistGUID 当有效过滤；与基线结果一致',
  assert: A.filterIgnored('track-list-default'),
  note: '文档明确要求改用 track/artist-detail/list',
});
await runCase({
  id: 'track-list-forged-authx', group: 'authx 签名',
  display: '/track/list?page=1&size=2（authx 头为伪造值）',
  path: () => '/track/list?page=1&size=2',
  headers: (() => ({ authx: ctx.authxValue }))(),
  expected: '本次所测只读请求携带伪造 authx 头仍返回 code 0',
  assert: A.authxAccepted(),
  note: '仅说明本次请求未被拒绝；不证明服务端读取了该字段，也不能推广为所有路由/版本都不校验',
});
await runCase({
  id: 'track-list-no-authx', group: 'authx 签名',
  display: '/track/list?page=1&size=2（无 authx 头）',
  path: () => '/track/list?page=1&size=2',
  expected: '本次所测只读请求不带 authx 头仍返回 code 0',
  assert: A.authxAccepted(),
  note: 'authx 由前端统一 fetch 客户端通过 header 发送；本次不强制所有路由校验',
});

const sortMatrix = [
  { id: 'sort-track-valid', group: '分页排序', display: '/track/list?sort=title,asc', path: () => `/track/list?page=1&size=2&sort=${q('title,asc')}`, expected: 'title,asc' },
  { id: 'sort-album-valid', group: '分页排序', display: '/album/list?sort=name,asc', path: () => `/album/list?page=1&size=2&sort=${q('name,asc')}`, expected: 'name,asc' },
  { id: 'sort-artist-valid', group: '分页排序', display: '/artist/list?sort=name,asc', path: () => `/artist/list?page=1&size=2&sort=${q('name,asc')}`, expected: 'name,asc' },
  { id: 'sort-genre-valid', group: '分页排序', display: '/genre/list?sort=name,asc', path: () => `/genre/list?page=1&size=2&sort=${q('name,asc')}`, expected: 'name,asc' },
  { id: 'sort-favorite-valid', group: '分页排序', display: '/favorite-track/list?sort=favoriteAt,desc', path: () => `/favorite-track/list?page=1&size=2&sort=${q('favoriteAt,desc')}`, expected: 'favoriteAt,desc' },
  { id: 'sort-album-tracks-valid', group: '分页排序', display: '/track/album-detail/list?albumGUID=<albumGUID>&sort=trackNo,asc', path: (c) => c.albumGuid ? `/track/album-detail/list?albumGUID=${q(c.albumGuid)}&page=1&size=2&sort=${q('trackNo,asc')}` : null, expected: 'trackNo,asc', skipReason: '未取得 albumGUID' },
  { id: 'sort-artist-tracks-valid', group: '分页排序', display: '/track/artist-detail/list?artistGUID=<artistGUID>&sort=createdAt,desc', path: (c) => c.artistGuid ? `/track/artist-detail/list?artistGUID=${q(c.artistGuid)}&page=1&size=2&sort=${q('createdAt,desc')}` : null, expected: 'createdAt,desc', skipReason: '未取得 artistGUID' },
  { id: 'sort-artist-albums-valid', group: '分页排序', display: '/album/artist-detail/list?artistGUID=<artistGUID>&sort=name,asc', path: (c) => c.artistGuid ? `/album/artist-detail/list?artistGUID=${q(c.artistGuid)}&page=1&size=2&sort=${q('name,asc')}` : null, expected: 'name,asc', skipReason: '未取得 artistGUID' },
  { id: 'sort-playlist-tracks-valid', group: '分页排序', display: '/track/playlist-detail/list?playlistGUID=<playlistGUID>&sort=title,asc', path: (c) => c.playlistGuid ? `/track/playlist-detail/list?playlistGUID=${q(c.playlistGuid)}&page=1&size=2&sort=${q('title,asc')}` : null, expected: 'title,asc', skipReason: '未取得 playlistGUID' },
];
for (const s of sortMatrix) {
  await runCase({
    id: s.id, group: s.group, display: s.display, path: s.path, skipReason: s.skipReason,
    expected: `HTTP 200 / code 0；sort 回显为 ${s.expected}，list 为数组`,
    assert: A.sortEcho(s.expected),
    note: '回显不等于已证明空库/并列项的实际排列顺序',
  });
}
const invalidSortMatrix = [
  { id: 'sort-track-invalid', group: '分页排序', display: '/track/list?sort=<invalid>', path: () => `/track/list?page=1&size=2&sort=${q('__not_a_field__,asc')}` },
  { id: 'sort-album-invalid', group: '分页排序', display: '/album/list?sort=<invalid>', path: () => `/album/list?page=1&size=2&sort=${q('__not_a_field__,asc')}` },
  { id: 'sort-artist-invalid', group: '分页排序', display: '/artist/list?sort=<invalid>', path: () => `/artist/list?page=1&size=2&sort=${q('__not_a_field__,asc')}` },
  { id: 'sort-genre-invalid', group: '分页排序', display: '/genre/list?sort=<invalid>', path: () => `/genre/list?page=1&size=2&sort=${q('__not_a_field__,asc')}` },
  { id: 'sort-favorite-invalid', group: '分页排序', display: '/favorite-track/list?sort=<invalid>', path: () => `/favorite-track/list?page=1&size=2&sort=${q('__not_a_field__,asc')}` },
  { id: 'sort-album-tracks-invalid', group: '分页排序', display: '/track/album-detail/list?albumGUID=<albumGUID>&sort=<invalid>', path: (c) => c.albumGuid ? `/track/album-detail/list?albumGUID=${q(c.albumGuid)}&page=1&size=2&sort=${q('__not_a_field__,asc')}` : null, skipReason: '未取得 albumGUID' },
  { id: 'sort-artist-tracks-invalid', group: '分页排序', display: '/track/artist-detail/list?artistGUID=<artistGUID>&sort=<invalid>', path: (c) => c.artistGuid ? `/track/artist-detail/list?artistGUID=${q(c.artistGuid)}&page=1&size=2&sort=${q('__not_a_field__,asc')}` : null, skipReason: '未取得 artistGUID' },
  { id: 'sort-artist-albums-invalid', group: '分页排序', display: '/album/artist-detail/list?artistGUID=<artistGUID>&sort=<invalid>', path: (c) => c.artistGuid ? `/album/artist-detail/list?artistGUID=${q(c.artistGuid)}&page=1&size=2&sort=${q('__not_a_field__,asc')}` : null, skipReason: '未取得 artistGUID' },
  { id: 'sort-playlist-tracks-invalid', group: '分页排序', display: '/track/playlist-detail/list?playlistGUID=<playlistGUID>&sort=<invalid>', path: (c) => c.playlistGuid ? `/track/playlist-detail/list?playlistGUID=${q(c.playlistGuid)}&page=1&size=2&sort=${q('__not_a_field__,asc')}` : null, skipReason: '未取得 playlistGUID' },
];
for (const s of invalidSortMatrix) {
  await runCase({
    id: s.id, group: s.group, display: s.display, path: s.path, skipReason: s.skipReason,
    expected: '非法 sort 仍 code 0，但 data.sort 回退为默认而非原样回显',
    assert: A.invalidSortEcho(),
    note: '以 sort 回显判断，不以空列表推断顺序',
  });
}

// ---------- 4. 曲目、元数据、播放、歌词 ----------
await runCase({
  id: 'track-metadata', group: '曲目', display: '/track/metadata?guid=<trackGUID>',
  path: (c) => c.trackGuid ? `/track/metadata?guid=${q(c.trackGuid)}` : null, skipReason: '未取得 trackGUID',
  expected: 'HTTP 200 / code 0；data 含 track 与 audioSpec，详情字段已记录',
  assert: A.success(
    (r) => hasKeys(r.json?.data, ['track', 'audioSpec']) && hasKeys(r.json?.data?.track, ['guid', 'title']) && r.json?.data?.audioSpec && typeof r.json.data.audioSpec === 'object',
    (r) => `track keys=[${keys(r.json?.data?.track)}], audioSpec keys=[${keys(r.json?.data?.audioSpec)}]`,
  ),
});
await runCase({ id: 'track-metadata-missing', group: '错误码', display: '/track/metadata', expected: '缺 guid → 100002', assert: A.invalid() });
await runCase({
  id: 'track-metadata-fake', group: '错误码', display: '/track/metadata?guid=<fakeGUID>',
  path: (c) => `/track/metadata?guid=${q(c.fakeGuid)}`,
  expected: '格式合法但不存在的 guid → 100005', assert: A.notFound(),
});
await runCase({
  id: 'track-stream-range', group: '播放', display: '/track/stream?guid=<trackGUID> Range: bytes=0-99',
  path: (c) => c.trackGuid ? `/track/stream?guid=${q(c.trackGuid)}` : null, skipReason: '未取得 trackGUID',
  range: 'bytes=0-99', accept: '*/*',
  expected: 'HTTP 206；audio/*；100 字节；Content-Range 存在',
  assert: A.range(),
  note: '只取前 100 字节，不下载完整媒体',
});
await runCase({
  id: 'track-stream-fake', group: '错误码', display: '/track/stream?guid=<fakeGUID>',
  path: (c) => `/track/stream?guid=${q(c.fakeGuid)}`, range: 'bytes=0-99', accept: '*/*',
  expected: '不存在 guid → HTTP 200 / 100005', assert: A.notFound(),
});
await runCase({ id: 'track-stream-missing', group: '错误码', display: '/track/stream', range: 'bytes=0-99', accept: '*/*', expected: '缺 guid → 100002', assert: A.invalid() });
await runCase({
  id: 'track-stream-unauth', group: '会话', display: '/track/stream?guid=<trackGUID>（无 Cookie）',
  path: (c) => c.trackGuid ? `/track/stream?guid=${q(c.trackGuid)}` : null, skipReason: '未取得 trackGUID',
  cookie: false, range: 'bytes=0-99', accept: '*/*',
  expected: '未登录 → HTTP 401 / 99999', assert: A.unauth(),
});
await runCase({
  id: 'hls-no-session', group: '播放', display: '/track/hls/<fakeGUID>/preset.m3u8',
  path: (c) => `/track/hls/${q(c.fakeGuid)}/preset.m3u8`, accept: 'application/vnd.apple.mpegurl, */*',
  expected: '未建立转码会话时不应取得可播放列表（仅信息性记录）',
  assert: A.info(), informational: true,
  note: '不建立/退出转码会话；GET 结果仅作路由观察，不视为 HLS 成功验证',
});
await runCase({
  id: 'lyric-list', group: '歌词', display: '/lyric/list?trackGUID=<trackGUID>',
  path: (c) => c.trackGuid ? `/lyric/list?trackGUID=${q(c.trackGuid)}` : null, skipReason: '未取得 trackGUID',
  expected: 'HTTP 200 / code 0；{list,preferred}',
  assert: A.success((r) => hasKeys(r.json?.data, ['list', 'preferred']) && Array.isArray(r.json?.data?.list), (r) => `list=${arrLen(r.json?.data, 'list')}, preferredPresent=${'preferred' in (r.json?.data || {})}`),
});
await runCase({
  id: 'lyric-list-misspelled', group: '错误码', display: '/lyric/list?trackGuid=<trackGUID>',
  path: (c) => c.trackGuid ? `/lyric/list?trackGuid=${q(c.trackGuid)}` : null, skipReason: '未取得 trackGUID',
  expected: '参数名必须是 trackGUID；误写 trackGuid → 100002', assert: A.invalid(),
});
await runCase({
  id: 'lyric-list-fake', group: '错误码', display: '/lyric/list?trackGUID=<fakeGUID>',
  path: (c) => `/lyric/list?trackGUID=${q(c.fakeGuid)}`,
  expected: '不存在 trackGUID → 100005 或 100002',
  assert: (r) => ({ pass: r.httpStatus === 200 && [100005, 100002].includes(r.json?.code), detail: `HTTP ${r.httpStatus}, code ${r.json?.code}` }),
});
await runCase({ id: 'lyric-list-missing', group: '错误码', display: '/lyric/list', expected: '缺 trackGUID → 100002', assert: A.invalid() });

// ---------- 5. 专辑、艺术家、流派、共享库 ----------
await runCase({
  id: 'album-detail', group: '专辑', display: '/album/detail?guid=<albumGUID>',
  path: (c) => c.albumGuid ? `/album/detail?guid=${q(c.albumGuid)}` : null, skipReason: '未取得 albumGUID',
  expected: 'HTTP 200 / code 0；返回 Album 对象（按实际字段兼容）', assert: A.object(['guid', 'name']),
});
await runCase({ id: 'album-detail-missing', group: '错误码', display: '/album/detail', expected: '缺 guid → 100002', assert: A.invalid() });
await runCase({ id: 'album-detail-fake', group: '错误码', display: '/album/detail?guid=<fakeGUID>', path: (c) => `/album/detail?guid=${q(c.fakeGuid)}`, expected: '不存在 guid → 100005', assert: A.notFound() });
await runCase({
  id: 'track-album-detail-list', group: '专辑', display: '/track/album-detail/list?albumGUID=<albumGUID>&page=1&size=2',
  path: (c) => c.albumGuid ? `/track/album-detail/list?albumGUID=${q(c.albumGuid)}&page=1&size=2` : null, skipReason: '未取得 albumGUID',
  expected: 'HTTP 200 / code 0；{list,total,sort}', assert: A.listWithSort(),
});
await runCase({ id: 'track-album-detail-missing', group: '错误码', display: '/track/album-detail/list', expected: '缺 albumGUID → 100002', assert: A.invalid() });

await runCase({
  id: 'artist-detail', group: '艺术家', display: '/artist/detail?guid=<artistGUID>',
  path: (c) => c.artistGuid ? `/artist/detail?guid=${q(c.artistGuid)}` : null, skipReason: '未取得 artistGUID',
  expected: 'HTTP 200 / code 0；返回 Artist 对象（按实际字段兼容）', assert: A.object(['guid', 'name']),
});
await runCase({ id: 'artist-detail-missing', group: '错误码', display: '/artist/detail', expected: '缺 guid → 100002', assert: A.invalid() });
await runCase({ id: 'artist-detail-fake', group: '错误码', display: '/artist/detail?guid=<fakeGUID>', path: (c) => `/artist/detail?guid=${q(c.fakeGuid)}`, expected: '不存在 guid → 100005', assert: A.notFound() });
await runCase({ id: 'artist-list-all', group: '艺术家', display: '/artist/list-all', expected: 'HTTP 200 / code 0；{list}，不是裸数组', assert: A.list(['list']) });
await runCase({
  id: 'track-artist-detail-list', group: '艺术家', display: '/track/artist-detail/list?artistGUID=<artistGUID>&page=1&size=2',
  path: (c) => c.artistGuid ? `/track/artist-detail/list?artistGUID=${q(c.artistGuid)}&page=1&size=2` : null, skipReason: '未取得 artistGUID',
  expected: 'HTTP 200 / code 0；{list,total,sort}', assert: A.listWithSort(),
});
await runCase({ id: 'track-artist-detail-missing', group: '错误码', display: '/track/artist-detail/list', expected: '缺 artistGUID → 100002', assert: A.invalid() });
await runCase({
  id: 'album-artist-detail-list', group: '艺术家', display: '/album/artist-detail/list?artistGUID=<artistGUID>&page=1&size=2',
  path: (c) => c.artistGuid ? `/album/artist-detail/list?artistGUID=${q(c.artistGuid)}&page=1&size=2` : null, skipReason: '未取得 artistGUID',
  expected: 'HTTP 200 / code 0；{list,total,sort}', assert: A.listWithSort(),
});
await runCase({ id: 'album-artist-detail-missing', group: '错误码', display: '/album/artist-detail/list', expected: '缺 artistGUID → 100002', assert: A.invalid() });

await runCase({ id: 'genre-detail-missing', group: '错误码', display: '/genre/detail', expected: '缺 guid → 100002', assert: A.invalid() });
await runCase({
  id: 'genre-detail-fake', group: '错误码', display: '/genre/detail?guid=<fakeGUID>',
  path: (c) => `/genre/detail?guid=${q(c.fakeGuid)}`,
  expected: '不存在 guid → 100005 或 100002；成功模型仍未验证',
  assert: (r) => ({ pass: r.httpStatus === 200 && [100005, 100002].includes(r.json?.code), detail: `HTTP ${r.httpStatus}, code ${r.json?.code}` }),
});
await runCase({
  id: 'track-genre-detail-list', group: '流派', display: '/track/genre-detail/list?genreGUID=<fakeGUID>&page=1&size=2',
  path: (c) => `/track/genre-detail/list?genreGUID=${q(c.fakeGuid)}&page=1&size=2`,
  expected: 'HTTP 200 / code 0；假 genreGUID 返回空列表', assert: A.list(),
  note: '空列表 code 0 不证明真实流派关系存在',
});
await runCase({ id: 'track-genre-detail-missing', group: '错误码', display: '/track/genre-detail/list', expected: '缺 genreGUID → 100002', assert: A.invalid() });

await runCase({
  id: 'shared-library-detail', group: '共享音乐库', display: '/shared-library/detail?guid=<libraryGUID>',
  path: (c) => c.libraryGuid ? `/shared-library/detail?guid=${q(c.libraryGuid)}` : null, skipReason: '未取得 libraryGUID',
  expected: 'HTTP 200 / code 0；返回 SharedLibrary 对象（按实际字段兼容）', assert: A.object(['guid']),
});
await runCase({ id: 'shared-library-detail-missing', group: '错误码', display: '/shared-library/detail', expected: '缺 guid → 100002', assert: A.invalid() });
await runCase({ id: 'shared-library-detail-fake', group: '错误码', display: '/shared-library/detail?guid=<fakeGUID>', path: (c) => `/shared-library/detail?guid=${q(c.fakeGuid)}`, expected: '不存在 guid → 100005', assert: A.notFound() });

// ---------- 6. 搜索 ----------
const searchKeyword = (c) => q(c.keyword);
await runCase({
  id: 'search-track-p1', group: '搜索', display: '/search/track?q=<keyword>&page=1&size=1',
  path: (c) => `/search/track?q=${searchKeyword(c)}&page=1&size=1`,
  expected: 'HTTP 200 / code 0；{list,total}', assert: A.list(),
  note: '关键字取自样本标题首字符，不写入结果',
});
await runCase({
  id: 'search-track-p2', group: '搜索', display: '/search/track?q=<keyword>&page=2&size=1',
  path: (c) => `/search/track?q=${searchKeyword(c)}&page=2&size=1`,
  expected: '所测 page/size 未生效：page2 与 page1 结果一致（样本不足时仅记录）',
  assert: A.searchPageCompare('search-track-p1'),
  note: '不保证大库没有服务端隐藏上限',
});
await runCase({ id: 'search-album', group: '搜索', display: '/search/album?q=<keyword>', path: (c) => `/search/album?q=${searchKeyword(c)}`, expected: 'HTTP 200 / code 0；{list,total}', assert: A.list() });
await runCase({ id: 'search-artist', group: '搜索', display: '/search/artist?q=<keyword>', path: (c) => `/search/artist?q=${searchKeyword(c)}`, expected: 'HTTP 200 / code 0；{list,total}', assert: A.list() });
await runCase({ id: 'search-playlist', group: '搜索', display: '/search/playlist?q=<keyword>', path: (c) => `/search/playlist?q=${searchKeyword(c)}`, expected: 'HTTP 200 / code 0；{list,total}', assert: A.list() });
await runCase({ id: 'search-playlist-no-q', group: '搜索', display: '/search/playlist', expected: 'playlist 搜索可省略 q；HTTP 200 / code 0', assert: A.list() });
await runCase({
  id: 'search-suggest', group: '搜索', display: '/search/suggest?q=<keyword>',
  path: (c) => `/search/suggest?q=${searchKeyword(c)}`,
  expected: 'HTTP 200 / code 0；track/album/artist/playlist 分组各含 total/items',
  assert: A.success(
    (r) => ['track', 'album', 'artist', 'playlist'].every((k) => hasKeys(r.json?.data?.[k], ['total', 'items'])),
    (r) => `groups=[${keys(r.json?.data)}]`,
  ),
});
for (const ep of ['track', 'album', 'artist', 'suggest']) {
  await runCase({ id: `search-${ep}-missing-q`, group: '错误码', display: `/search/${ep}`, expected: `search/${ep} 缺 q → 100002`, assert: A.invalid() });
}

// ---------- 7. 收藏、历史、歌单 ----------
await runCase({ id: 'favorite-purge-count', group: '收藏', display: '/favorite-track/purge-track-count', expected: 'HTTP 200 / code 0；data.total 为数字', assert: A.success((r) => typeof r.json?.data?.total === 'number', (r) => `total=${numVal(r.json?.data, 'total')}`) });
await runCase({
  id: 'playlist-detail', group: '歌单', display: '/playlist/detail?guid=<playlistGUID>',
  path: (c) => c.playlistGuid ? `/playlist/detail?guid=${q(c.playlistGuid)}` : null, skipReason: '未取得 playlistGUID',
  expected: 'HTTP 200 / code 0；PlaylistDetail 含 trackCount', assert: A.object(['guid', 'name', 'trackCount']),
});
await runCase({ id: 'playlist-detail-missing', group: '错误码', display: '/playlist/detail', expected: '缺 guid → 100002', assert: A.invalid() });
await runCase({ id: 'playlist-detail-fake', group: '错误码', display: '/playlist/detail?guid=<fakeGUID>', path: (c) => `/playlist/detail?guid=${q(c.fakeGuid)}`, expected: '不存在 guid → 100005', assert: A.notFound() });
await runCase({
  id: 'playlist-batch-detail', group: '歌单', display: '/playlist/batch-detail?guids=<playlistGUID>',
  path: (c) => c.playlistGuid ? `/playlist/batch-detail?guids=${q(c.playlistGuid)}` : null, skipReason: '未取得 playlistGUID',
  expected: 'HTTP 200 / code 0；{list:PlaylistDetail[]}', assert: A.success((r) => Array.isArray(r.json?.data?.list) && (r.json.data.list.length === 0 || hasKeys(r.json.data.list[0], ['trackCount'])), (r) => `list=${arrLen(r.json?.data, 'list')}`),
});
await runCase({
  id: 'playlist-batch-detail-missing', group: '歌单', display: '/playlist/batch-detail',
  expected: '缺 guids → HTTP 200 / code 0 且空列表',
  assert: A.success((r) => Array.isArray(r.json?.data?.list) && r.json.data.list.length === 0, (r) => `list=${arrLen(r.json?.data, 'list')}`),
});
await runCase({
  id: 'playlist-purge-count', group: '歌单', display: '/playlist/purge-track-count?guid=<playlistGUID>',
  path: (c) => c.playlistGuid ? `/playlist/purge-track-count?guid=${q(c.playlistGuid)}` : null, skipReason: '未取得 playlistGUID',
  expected: 'HTTP 200 / code 0；data.total 为数字', assert: A.success((r) => typeof r.json?.data?.total === 'number', (r) => `total=${numVal(r.json?.data, 'total')}`),
});
await runCase({ id: 'playlist-purge-count-missing', group: '错误码', display: '/playlist/purge-track-count', expected: '缺 guid → 100002', assert: A.invalid() });
await runCase({
  id: 'track-playlist-detail-list', group: '歌单', display: '/track/playlist-detail/list?playlistGUID=<playlistGUID>&page=1&size=2',
  path: (c) => c.playlistGuid ? `/track/playlist-detail/list?playlistGUID=${q(c.playlistGuid)}&page=1&size=2` : null, skipReason: '未取得 playlistGUID',
  expected: 'HTTP 200 / code 0；{list,total,sort}，默认 sort 回显 trackAddedAt,desc', assert: A.listWithSort(),
});
await runCase({ id: 'track-playlist-detail-missing', group: '错误码', display: '/track/playlist-detail/list', expected: '缺 playlistGUID → 100002', assert: A.invalid() });
await runCase({ id: 'history-list', group: '播放历史', display: '/play-history/list?page=1&size=2', expected: 'HTTP 200 / code 0；{list,total}', assert: A.list(), note: '无已确认 sort 回显；空账号不能复测非空语义' });

// ---------- 8. 封面 ----------
await runCase({
  id: 'cover-size-160', group: '封面', display: '/static/cover?coverId=<coverId>&size=160',
  path: (c) => c.coverId ? `/static/cover?coverId=${q(c.coverId)}&size=160` : null, skipReason: '未取得 coverId',
  accept: '*/*', expected: 'HTTP 200；image/*；Cache-Control public/immutable', assert: A.image(),
});
await runCase({
  id: 'cover-no-size', group: '封面', display: '/static/cover?coverId=<coverId>',
  path: (c) => c.coverId ? `/static/cover?coverId=${q(c.coverId)}` : null, skipReason: '未取得 coverId',
  accept: '*/*', expected: '服务端不传 size 返回原图；HTTP 200 image/*', assert: A.image(),
});
await runCase({
  id: 'cover-size-999', group: '封面', display: '/static/cover?coverId=<coverId>&size=999',
  path: (c) => c.coverId ? `/static/cover?coverId=${q(c.coverId)}&size=999` : null, skipReason: '未取得 coverId',
  accept: '*/*', expected: '大尺寸样本返回图片；HTTP 200 image/*', assert: A.image(),
  note: '字节数相同不能直接证明参数被拒',
});
await runCase({ id: 'cover-missing', group: '错误码', display: '/static/cover', accept: '*/*', expected: '缺 coverId → HTTP 400 非 JSON/空体', assert: A.http400() });
await runCase({
  id: 'cover-fake', group: '错误码', display: '/static/cover?coverId=<knownPrefix>_<fakeGUID>',
  path: (c) => `/static/cover?coverId=${q('album_' + c.fakeGuid)}`, accept: '*/*',
  expected: '已知前缀但资源不存在的 coverId → 非 JSON 错误；本次实测为 HTTP 404 text/plain 短正文',
  assert: (r) => ({
    pass: [400, 404].includes(r.httpStatus) && !r.contentType.includes('application/json') && r.bodyLength < 128,
    detail: `HTTP ${r.httpStatus}, contentType=${short(r.contentType)}, byteLength=${r.bodyLength}`,
  }),
  note: '历史记录为 HTTP400；本次实例返回 HTTP404。应按 HTTP 状态与非 JSON 正文兼容处理，不能强制解析 JSON',
});
await runCase({
  id: 'cover-bare-guid', group: '错误码', display: '/static/cover?coverId=<bareGUID>',
  path: (c) => `/static/cover?coverId=${q(c.fakeGuid)}`, accept: '*/*',
  expected: '不带已知前缀的 coverId → HTTP 400 非 JSON/空体', assert: A.http400(),
  note: 'coverId 应带 album_/artist_/track_/playlist_ 等前缀，不要只发送裸 GUID',
});
await runCase({
  id: 'cover-unauth', group: '会话', display: '/static/cover?coverId=<coverId>（无 Cookie）',
  path: (c) => c.coverId ? `/static/cover?coverId=${q(c.coverId)}&size=160` : null, skipReason: '未取得 coverId',
  cookie: false, accept: '*/*', expected: '未登录 → HTTP 401 / 99999', assert: A.unauth(),
});

// ---------- 9. 管理/授权目录/任务（仅成员拒绝或错误分支） ----------
await runCase({ id: 'user-list-admin', group: '管理接口', display: '/user/list', expected: '成员 → 100003', assert: A.admin() });
await runCase({ id: 'user-exists-admin', group: '管理接口', display: '/user/exists?username=<probe>', path: (c) => `/user/exists?username=${q(c.probeUsername)}`, expected: '成员 → 100003', assert: A.admin(), note: '100003 不能证明 username 参数有效' });
await runCase({ id: 'settings-server-admin', group: '管理接口', display: '/settings/server', expected: '成员 → 100003', assert: A.admin() });
await runCase({ id: 'settings-user-admin', group: '管理接口', display: '/settings/user', expected: '成员 → 100003', assert: A.admin(), note: '不要按路径名误判为普通用户自助设置' });
await runCase({ id: 'authed-dir-list-admin', group: '管理接口', display: '/app-center/authed-dir/list', expected: '成员 → 100003', assert: A.admin() });
await runCase({ id: 'authed-dir-sub-missing', group: '错误码', display: '/app-center/authed-dir/sub/list', expected: '缺 parent → 100002', assert: A.invalid() });
await runCase({ id: 'authed-dir-sub-admin', group: '管理接口', display: '/app-center/authed-dir/sub/list?parent=<parent>', path: (c) => `/app-center/authed-dir/sub/list?parent=${q(c.probeParent)}`, expected: '提供 parent 后成员 → 100003', assert: A.admin() });
await runCase({
  id: 'task-detail-fake', group: '任务', display: '/task/detail?taskId=<fakeTaskId>',
  path: (c) => `/task/detail?taskId=${q(c.fakeGuid)}`,
  expected: '假 taskId → 200010001/100002/100001 错误分支；成功参数待确认',
  assert: (r) => ({ pass: r.httpStatus === 200 && [200010001, 100002, 100001].includes(r.json?.code), detail: `HTTP ${r.httpStatus}, code ${r.json?.code}` }),
  note: '非前端注册表路径；不对真实任务执行 cancel/delete/retry',
});

// ---------- 10. 未登录与会話失效 ----------
await runCase({
  id: 'user-me-unauth', group: '会话', display: '/user/me（无 Cookie）',
  path: () => '/user/me', cookie: false,
  expected: '未登录 → HTTP 401 / 99999', assert: A.unauth(),
});
await runCase({
  id: 'logout', group: '认证', method: 'POST', display: '/user/logout', body: () => ({}),
  expected: 'HTTP 200 / code 0；data 为 null', assert: A.logout(),
});
ctx.loggedOut = true;
await runCase({
  id: 'user-me-after-logout', group: '会话', display: '/user/me（登出后复用 token）',
  path: () => '/user/me',
  expected: '登出后原 token 失效 → HTTP 401 / 99999', assert: A.unauth(),
  note: '公开配置不应被笼统归为退出后所有接口都 401',
});

// ---------- 汇总 ----------
const summary = {
  total: results.length,
  passed: results.filter((r) => r.pass === true && !r.informational && !r.skipped).length,
  failed: results.filter((r) => r.pass === false && !r.skipped).length,
  skipped: results.filter((r) => r.skipped).length,
  informational: results.filter((r) => r.informational && !r.skipped).length,
};
const cfg = rawById.get('sys-config')?.json?.data || {};
const output = {
  meta: {
    generatedAt: startedAt,
    target: '<用户提供并授权的测试实例>',
    origin: '<redacted>',
    account: '<测试账号；凭据与令牌未写入>',
    serverVersionObserved: cfg.serverVersion || 'n/a',
    mediasrvVersionObserved: cfg.mediasrvVersion || 'n/a',
    scope: '只读验证：公开配置、登录/登出、列表/详情/搜索/封面/Range 音频、错误码、成员权限拒绝、会话失效',
    policy: '未写入密码、用户名、令牌、Cookie、GUID、coverId、内网地址、服务器目录、音频/图片正文；仅记录状态码、业务码、字段形状与脱敏断言',
  },
  skippedByDesign: [
    'POST /user/passwd-change、/user/create、/user/edit、/user/delete、/user/unbanned：改密与用户管理写操作',
    'POST /favorite-track/create、/delete、/purge-track：收藏写入与不可完整回滚的清理',
    'POST /play-history/delete、/event/report：历史删除与有状态事件上报',
    'POST /playlist/create、/edit、/delete、/add-track、/remove-track、/purge-track：歌单写操作',
    'POST /static/cover/playlist、/static/cover/track：封面上传，可能留下孤儿文件',
    'POST /track/metadata、/artist/create、/genre/create、/search/index/rebuild：管理员写入或索引重建',
    'POST /shared-library/* 写操作、/app-center/authed-dir/sub/create：媒体库维护与目录创建',
    'POST /task/cancel、/delete、/retry：真实任务控制',
    'POST /track/transcode、/heartbeat、/quit 与 GET /track/roam-*：会建立/改变会话或漫游状态',
    'POST /initialization/prepare、/confirm、/user/auth-login：初始化与 OAuth 成功流程需专用环境',
    '错误密码、空密码、限流/锁定探测：避免影响现用账号',
  ],
  summary,
  cases: results,
};
await fs.mkdir(path.dirname(OUT), { recursive: true });
await fs.writeFile(OUT, JSON.stringify(output, null, 2) + '\n', 'utf8');
console.log(`验证完成：总数 ${summary.total}，通过 ${summary.passed}，失败 ${summary.failed}，跳过 ${summary.skipped}，信息性 ${summary.informational}`);
if (summary.failed > 0) {
  console.log('失败用例：' + results.filter((r) => r.pass === false && !r.skipped).map((r) => r.id).join(', '));
}
console.log(`结果：${OUT}`);
if (summary.failed > 0) process.exitCode = 1;
