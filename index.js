/**
 * TokenView — Host half.
 *
 * Exposes a prefix route `/api/token-view` on the composition's Web server so the
 * browser client can fetch Token balance data through the Host (same-origin, no
 * CORS). The API key never leaves the Host; the browser calls in through the
 * Connection service's browser-trust gate (`requestRejection`).
 *
 * Routes:
 *   GET  /api/token-view/config   -> { refreshInterval, configured, fields } (no apiKey)
 *   POST /api/token-view/refresh  -> { ok: true, at, fields:[{name,value}] }
 *                                   or { error: { code, message } }
 */
import z from '@deepseek-ai/schemastery';

export const name = 'token-view';
export const inject = [];

/** 默认字段（沿用旧 YYXX 预设 8 字段）。 */
export const DEFAULT_FIELDS = [
  { name: '账户名', path: 'data.name', calc: '' },
  { name: '总授予', path: 'data.total_granted', calc: '' },
  { name: '已用', path: 'data.total_used', calc: '' },
  { name: '剩余可用', path: 'data.total_available', calc: '' },
  { name: '是否无限额度', path: 'data.unlimited_quota', calc: '' },
  { name: '过期时间', path: 'data.expires_at', calc: '' },
  { name: '总金额(USD)', path: '', calc: '{data.total_granted} / 500000' },
  { name: '余额(USD)', path: '', calc: '{data.total_available} / 500000' },
];

/** 宿主支持 `.volatile()` 时启用（host schemastery >= 3.18.3）。 */
function applyVolatile(field) {
  return typeof field?.volatile === 'function' ? field.volatile() : field;
}

export const Config = z.object({
  refreshInterval: applyVolatile(z.number().default(30)),
  apiUrl: applyVolatile(z.string().default('')),
  apiKey: applyVolatile(z.string().default('')),
  authHeader: applyVolatile(z.string().default('Authorization')),
  authPrefix: applyVolatile(z.string().default('Bearer ')),
  fields: applyVolatile(z.array(z.object({
    name: z.string().default(''),
    path: z.string().default(''),
    calc: z.string().default(''),
  })).default(DEFAULT_FIELDS)),
});

/** 解引用 volatile 字段：`{ get() }` 引用 → 值；普通值原样返回。 */
export function readVolatile(ref) {
  try {
    if (ref !== null && typeof ref === 'object' && typeof ref.get === 'function') return ref.get();
    return ref;
  } catch {
    return undefined;
  }
}

const INTERVAL_MIN = 5;
const INTERVAL_MAX = 3600;

/** 归一化配置；refreshInterval 夹到 [5,3600]，fields 为空时回填默认 8 字段。 */
export function resolveConfig(config) {
  const interval = readVolatile(config?.refreshInterval);
  const n = Number(interval);
  const refreshInterval = Number.isFinite(n) ? Math.max(INTERVAL_MIN, Math.min(INTERVAL_MAX, Math.trunc(n))) : 30;
  const rawFields = readVolatile(config?.fields);
  const fields = (Array.isArray(rawFields) && rawFields.length > 0 ? rawFields : DEFAULT_FIELDS).map((f) => ({
    name: String(f?.name ?? ''),
    path: String(f?.path ?? ''),
    calc: String(f?.calc ?? ''),
  }));
  return {
    refreshInterval,
    apiUrl: String(readVolatile(config?.apiUrl) ?? '').trim(),
    apiKey: String(readVolatile(config?.apiKey) ?? ''),
    authHeader: String(readVolatile(config?.authHeader) ?? '').trim() || 'Authorization',
    authPrefix: String(readVolatile(config?.authPrefix) ?? ''),
    fields,
  };
}

/** JSONPath：支持 `data.list[0].x`；取不到返回 null，绝不抛异常。 */
export function resolvePath(obj, path) {
  if (!path) return null;
  const parts = String(path).match(/[^.\[\]]+|\[\d+\]/g) || [];
  let cur = obj;
  for (const part of parts) {
    if (part[0] === '[' && part[part.length - 1] === ']') {
      const idx = Number.parseInt(part.slice(1, -1), 10);
      if (Array.isArray(cur) && -cur.length <= idx && idx < cur.length) cur = cur[idx];
      else return null;
    } else if (cur !== null && typeof cur === 'object' && !Array.isArray(cur) && Object.prototype.hasOwnProperty.call(cur, part)) {
      cur = cur[part];
    } else {
      return null;
    }
  }
  return cur;
}

/** 把数值转成不含科学计数法的字符串（safeEval 不接受 e/E 指数记法）。 */
function numberToPlainString(value) {
  const s = String(value);
  if (!/[eE]/.test(s)) return s;
  return Number(value).toLocaleString('en-US', { useGrouping: false, maximumFractionDigits: 20 });
}

/** 把 `{路径}` 替换为数值；取不到/非数值替换为 `0`。 */
export function buildCalcExpr(template, data) {
  return String(template).replace(/\{([^}]*)\}/g, (_m, key) => {
    const val = resolvePath(data, String(key).trim());
    if (typeof val === 'number' && Number.isFinite(val)) return numberToPlainString(val);
    if (typeof val === 'string' && val.trim() !== '' && Number.isFinite(Number(val))) return numberToPlainString(Number(val));
    return '0';
  });
}

const SAFE_FUNCTIONS = new Set(['round', 'int', 'float', 'abs', 'min', 'max']);

/**
 * 安全求值：仅允许数字、四则/幂运算（+ - * / **）、括号与
 * round/int/float/abs/min/max 六个函数；其它任何字符/标识符都抛错。绝不 `eval` 任意字符串。
 */
export function safeEval(expr) {
  const source = String(expr).trim();
  const tokens = [];
  let i = 0;
  const len = source.length;
  while (i < len) {
    const c = source[i];
    if (/\s/.test(c)) { i += 1; continue; }
    if (/[0-9]/.test(c) || c === '.') {
      let j = i;
      while (j < len && /[0-9.]/.test(source[j])) j += 1;
      const num = source.slice(i, j);
      if (!/^(\d+(\.\d*)?|\.\d+)$/.test(num)) throw new Error('非法数字');
      tokens.push(num);
      i = j;
      continue;
    }
    if (/[A-Za-z_]/.test(c)) {
      let j = i;
      while (j < len && /[A-Za-z0-9_]/.test(source[j])) j += 1;
      const ident = source.slice(i, j);
      if (!SAFE_FUNCTIONS.has(ident)) throw new Error('不允许的标识符: ' + ident);
      tokens.push(ident);
      i = j;
      continue;
    }
    if (c === '*' && source[i + 1] === '*') { tokens.push('**'); i += 2; continue; }
    if ('+-*/(),'.includes(c)) { tokens.push(c); i += 1; continue; }
    throw new Error('不允许的字符: ' + c);
  }
  const code = tokens.join('');
  // eslint-disable-next-line no-new-func
  const fn = new Function('round', 'int', 'float', 'abs', 'min', 'max', `"use strict"; return (${code});`);
  return fn(Math.round, (x) => Math.trunc(Number(x)), (x) => Number(x), Math.abs, Math.min, Math.max);
}

/** 值格式化：整数千分位、浮点 2 位、boolean → true/false、null → "——"、对象 JSON 化。 */
export function formatValue(value) {
  if (value === null || value === undefined) return '——';
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return '——';
    if (Number.isInteger(value)) return value.toLocaleString('en-US');
    return value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'string') return value;
  return JSON.stringify(value);
}

const PREFIX = '/api/token-view';
const WEB_SERVER_KEYS = ['webServer', 'httpServer'];
const HEADER_NAME_RE = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/;

class UpstreamError extends Error {
  constructor(message) { super(message); this.name = 'UpstreamError'; }
}
class ConfigError extends Error {
  constructor(message) { super(message); this.name = 'ConfigError'; }
}

function sendJson(res, status, payload) {
  if (res.headersSent) { res.destroy(); return; }
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(JSON.stringify(payload));
}
function errEnvelope(code, message) { return { error: { code, message } }; }

/** Host 侧经 Node 全局 fetch 请求外部余额接口；超时 15s；失败归为 UpstreamError。 */
async function fetchUpstream(cfg) {
  if (!HEADER_NAME_RE.test(cfg.authHeader)) throw new ConfigError('authHeader 非法');
  const headers = { 'User-Agent': 'TokenView/1.0' };
  if (cfg.apiKey) headers[cfg.authHeader] = cfg.authPrefix + cfg.apiKey;
  let res;
  try {
    res = await fetch(cfg.apiUrl, { method: 'GET', headers, signal: AbortSignal.timeout(15000) });
  } catch (err) {
    if (err?.name === 'TimeoutError' || err?.name === 'AbortError') throw new UpstreamError('请求超时');
    throw new UpstreamError('无法连接接口');
  }
  if (!res.ok) throw new UpstreamError('接口返回 HTTP ' + res.status);
  let data;
  try {
    data = await res.json();
  } catch {
    throw new UpstreamError('接口返回非 JSON');
  }
  if (data === null || typeof data !== 'object' || Array.isArray(data)) throw new UpstreamError('接口返回格式非法');
  return data;
}

async function handleRoute(req, res, ctx, config) {
  // 浏览器信任门：connection 每次请求现取（该行可能晚于路由激活）。
  const conn = ctx.get('connection');
  if (conn !== undefined) {
    const rejection = conn.requestRejection(req);
    if (rejection !== undefined) {
      sendJson(res, rejection, errEnvelope(rejection === 401 ? 'UNAUTHORIZED' : 'FORBIDDEN', rejection === 401 ? 'unauthorized' : 'forbidden'));
      return;
    }
  }
  const url = new URL(req.url ?? '/', 'http://localhost');
  const method = req.method ?? 'GET';
  const pathname = url.pathname;

  if (pathname === `${PREFIX}/config`) {
    if (method !== 'GET') { sendJson(res, 405, errEnvelope('METHOD_NOT_ALLOWED', 'method not allowed')); return; }
    const cfg = resolveConfig(config);
    sendJson(res, 200, {
      refreshInterval: cfg.refreshInterval,
      configured: cfg.apiUrl !== '' && cfg.fields.length > 0,
      fields: cfg.fields.map((f) => ({ name: f.name, path: f.path, calc: f.calc })),
    });
    return;
  }

  if (pathname === `${PREFIX}/refresh`) {
    if (method !== 'POST') { sendJson(res, 405, errEnvelope('METHOD_NOT_ALLOWED', 'method not allowed')); return; }
    const cfg = resolveConfig(config);
    if (cfg.apiUrl === '' || cfg.fields.length === 0) {
      sendJson(res, 400, errEnvelope('NOT_CONFIGURED', 'not configured: set API URL and fields'));
      return;
    }
    try {
      const data = await fetchUpstream(cfg);
      const fields = cfg.fields.map((f) => {
        try {
          const value = f.calc ? safeEval(buildCalcExpr(f.calc, data)) : resolvePath(data, f.path);
          return { name: f.name, value: formatValue(value) };
        } catch {
          return { name: f.name, value: '——' };
        }
      });
      sendJson(res, 200, { ok: true, at: new Date().toISOString(), fields });
    } catch (err) {
      if (err instanceof UpstreamError) sendJson(res, 502, errEnvelope('UPSTREAM_ERROR', err.message));
      else if (err instanceof ConfigError) sendJson(res, 500, errEnvelope('CONFIG_ERROR', err.message));
      else sendJson(res, 500, errEnvelope('INTERNAL_ERROR', 'internal error'));
    }
    return;
  }

  sendJson(res, 404, errEnvelope('NOT_FOUND', 'unknown route'));
}

export function apply(ctx, config) {
  let webRegistered = false;
  const registerWebSurface = () => {
    if (webRegistered) return;
    const webServer = ctx.get(WEB_SERVER_KEYS[0]) ?? ctx.get(WEB_SERVER_KEYS[1]);
    if (webServer === undefined) return;
    ctx.effect(() => webServer.register({
      kind: 'prefix',
      path: PREFIX,
      handler: async (req, res) => {
        try {
          await handleRoute(req, res, ctx, config);
        } catch (err) {
          ctx.logger?.warn?.(`token-view: ${String(err)}`);
          sendJson(res, 500, errEnvelope('INTERNAL_ERROR', 'internal error'));
        }
      },
    }), 'token-view: http');
    webRegistered = true;
  };
  registerWebSurface();
  ctx.on('internal/service', (serviceName) => {
    if (serviceName === WEB_SERVER_KEYS[0] || serviceName === WEB_SERVER_KEYS[1]) registerWebSurface();
  });
}