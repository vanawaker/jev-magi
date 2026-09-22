import { createServer } from 'node:http';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { commandSchema, evaluateJev, JevError } from '../lib/jev.ts';

const LOCAL_HOSTS = ['localhost', '127.0.0.1', '[::1]'];
const TYPES = { js: 'text/javascript; charset=utf-8', css: 'text/css; charset=utf-8', woff2: 'font/woff2', svg: 'image/svg+xml', png: 'image/png' };
const hostname = host => { try { return new URL(`http://${host}`).hostname; } catch { return null; } };
const validKey = key => key.length <= 512 && !/[^\x21-\x7e]/.test(key);

export function createMagiServer({ key = '', publicDir, allowedHosts = [], evaluate = evaluateJev, concurrent = 3 }) {
  if (key && !validKey(key)) throw Error('TYPESAFE_API_KEY contains invalid characters');
  // Only known host names are served, so a hostile page cannot reach this server through DNS rebinding.
  const hosts = new Set([...LOCAL_HOSTS, ...allowedHosts.map(host => host.trim().toLowerCase()).filter(Boolean)]);
  const files = new Map();
  files.set('/', { body: readFileSync(join(publicDir, 'index.html')), type: 'text/html; charset=utf-8' });
  files.set('/favicon.svg', { body: readFileSync(join(publicDir, 'favicon.svg')), type: TYPES.svg });
  for (const file of readdirSync(join(publicDir, 'assets'))) {
    const type = TYPES[file.split('.').pop()];
    if (type && /^[\w.-]+$/.test(file)) files.set(`/assets/${file}`, { body: readFileSync(join(publicDir, 'assets', file)), type, immutable: true });
  }
  const security = {
    'Content-Security-Policy': "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self'; img-src 'self' data:; font-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'",
    'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer',
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=(), usb=()',
    'Cross-Origin-Opener-Policy': 'same-origin', 'Cross-Origin-Resource-Policy': 'same-origin',
    'X-Frame-Options': 'DENY', 'Cache-Control': 'no-store',
  };
  const json = (res, status, body, headers = {}) => {
    if (res.destroyed) return;
    res.writeHead(status, { ...security, 'Content-Type': 'application/json; charset=utf-8', ...headers });
    res.end(JSON.stringify(body));
  };
  const reject = (res, status, message, headers) => json(res, status, { error: message }, headers);
  let inFlight = 0;
  async function handle(req, res) {
    if (req.url.length > 1024) return reject(res, 414, '請求地址過長。');
    if (!hosts.has(hostname(req.headers.host || ''))) return reject(res, 421, '此主機名未被允許，請將它加入 ALLOWED_HOSTS。');
    const path = req.url.split('?')[0];
    if (!path.startsWith('/api/')) {
      const file = files.get(path);
      if (!file) return reject(res, 404, '頁面不存在。');
      if (!['GET', 'HEAD'].includes(req.method)) return reject(res, 405, '請求方式無效。', { Allow: 'GET, HEAD' });
      res.writeHead(200, { ...security, 'Content-Type': file.type, 'Content-Length': file.body.length, 'Cache-Control': file.immutable ? 'public, max-age=31536000, immutable' : 'no-store' });
      res.end(req.method === 'HEAD' ? undefined : file.body); return;
    }
    if (path === '/api/status') {
      if (req.method !== 'GET') return reject(res, 405, '請求方式無效。', { Allow: 'GET' });
      return json(res, 200, { configured: Boolean(key) });
    }
    if (path !== '/api/evaluate') return reject(res, 404, '介面不存在。');
    if (req.method !== 'POST') return reject(res, 405, '請求方式無效。', { Allow: 'POST' });
    if (req.headers.origin !== undefined) {
      let origin = null;
      try { origin = new URL(req.headers.origin).host; } catch {}
      if (origin !== req.headers.host) return reject(res, 403, '請從 MAGI 頁面發起議決。');
    }
    // A key sent by the page is used as is and never falls back to the server's key.
    const supplied = Object.hasOwn(req.headers, 'x-typesafe-key');
    const apiKey = supplied ? String(req.headers['x-typesafe-key']).trim() : key;
    if (supplied && (!apiKey || !validKey(apiKey))) return json(res, 400, { error: 'API Key 格式不正確，請重新填寫。', code: 'INVALID_KEY' });
    if (!apiKey) return json(res, 401, { error: '請先填入 TypeSafe API Key。', code: 'KEY_REQUIRED' });
    if (req.headers['content-encoding'] || !/^application\/json(?:\s*;|$)/i.test(req.headers['content-type'] || '')) return reject(res, 415, '請求格式無效。');
    if (Number(req.headers['content-length'] || 0) > 16000) return reject(res, 413, '議案內容過長。');
    let size = 0;
    const parts = [];
    for await (const part of req) {
      size += part.length;
      if (size > 16000) { reject(res, 413, '議案內容過長。'); return; }
      parts.push(part);
    }
    let input;
    try { input = commandSchema.parse(JSON.parse(Buffer.concat(parts).toString('utf8'))); }
    catch { return reject(res, 400, '請輸入 1–1200 字的議案。'); }
    if (inFlight >= concurrent) return reject(res, 503, '三個單元正忙，請稍後再試。', { 'Retry-After': '5' });
    inFlight++;
    try {
      return json(res, 200, await evaluate(input, apiKey));
    } catch (error) {
      const known = error instanceof JevError;
      if (known && error.status === 401) return json(res, 401, { error: supplied ? '這個 API Key 無效或不可用，請檢查後重新填寫。' : '伺服器設定的 API Key 無效或不可用。', code: 'INVALID_KEY' });
      return reject(res, known && [429, 504].includes(error.status) ? error.status : 502, known ? error.message : 'MAGI 暫時無法完成議決，請稍後再試。');
    } finally { inFlight--; }
  }
  const server = createServer({ maxHeaderSize: 8192, requestTimeout: 10000, headersTimeout: 5000, keepAliveTimeout: 5000 }, (req, res) => {
    handle(req, res).catch(() => { reject(res, 500, 'MAGI 暫時無法完成議決，請稍後再試。'); });
  });
  server.maxConnections = 64;
  server.maxRequestsPerSocket = 100;
  return server;
}
