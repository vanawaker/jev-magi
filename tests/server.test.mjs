import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import { request as httpRequest } from 'node:http';
import { createMagiServer } from '../server/server.mjs';
import { JevError } from '../lib/jev.ts';

const verdict = { votes: { melchior: true, balthasar: false, casper: true }, approved: true };
const pageKey = 'apikey_page_test_credential_1234';
async function setup(t, options = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'jev-magi-test-'));
  mkdirSync(join(dir, 'assets'));
  writeFileSync(join(dir, 'index.html'), '<h1>MAGI</h1>');
  writeFileSync(join(dir, 'favicon.svg'), '<svg/>');
  writeFileSync(join(dir, 'assets', 'app.js'), 'console.log("MAGI")');
  const keys = [];
  const server = createMagiServer({ publicDir: dir, evaluate: async (input, key) => { keys.push(key); return verdict; }, ...options });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const port = server.address().port;
  t.after(async () => { const closed = once(server, 'close'); server.close(); server.closeAllConnections(); await closed; rmSync(dir, { recursive: true, force: true }); });
  const request = (path, { method = 'GET', headers = {}, body, host = `localhost:${port}` } = {}) => new Promise((resolve, reject) => {
    const req = httpRequest({ host: '127.0.0.1', port, path, method, headers: { Host: host, ...headers } }, res => {
      const chunks = []; res.on('data', chunk => chunks.push(chunk));
      res.on('end', () => { const text = Buffer.concat(chunks).toString('utf8'); resolve({ status: res.statusCode, headers: res.headers, text, json: () => JSON.parse(text) }); });
    }); req.on('error', reject); req.end(body);
  });
  const vote = (headers = {}, proposal = '今晚不加班，回家打遊戲。', host) => request('/api/evaluate', { method: 'POST', host,
    headers: { Origin: `http://${host || `localhost:${port}`}`, 'Content-Type': 'application/json', ...headers }, body: JSON.stringify({ proposal }) });
  return { request, vote, keys, port };
}

test('the page, assets and status are served with security headers', async t => {
  const app = await setup(t);
  const page = await app.request('/');
  assert.equal(page.status, 200); assert.equal(page.text, '<h1>MAGI</h1>');
  assert.match(page.headers['content-security-policy'], /frame-ancestors 'none'/);
  assert.equal(page.headers['cache-control'], 'no-store');
  assert.match((await app.request('/assets/app.js')).headers['cache-control'], /immutable/);
  assert.equal((await app.request('/missing')).status, 404);
  assert.deepEqual((await app.request('/api/status')).json(), { configured: false });
});

test('the server key is used when the page sends none; a page key never falls back to it', async t => {
  const app = await setup(t, { key: 'apikey_server_test_credential_1234' });
  assert.deepEqual((await app.request('/api/status')).json(), { configured: true });
  const own = await app.vote();
  assert.equal(own.status, 200); assert.deepEqual(own.json(), verdict);
  assert.equal((await app.vote({ 'X-TypeSafe-Key': pageKey })).status, 200);
  const blank = await app.vote({ 'X-TypeSafe-Key': ' ' });
  assert.equal(blank.status, 400); assert.equal(blank.json().code, 'INVALID_KEY');
  assert.deepEqual(app.keys, ['apikey_server_test_credential_1234', pageKey]);
});

test('without any key the page is asked for one and Jev is not called', async t => {
  const app = await setup(t);
  const response = await app.vote();
  assert.equal(response.status, 401); assert.equal(response.json().code, 'KEY_REQUIRED');
  assert.equal((await app.vote({ 'X-TypeSafe-Key': pageKey })).status, 200);
  assert.deepEqual(app.keys, [pageKey]);
});

test('input with no yes-or-no answer comes back invalid', async t => {
  const app = await setup(t, { key: 'k', evaluate: async () => ({ invalid: true }) });
  const response = await app.vote({}, '吃火鍋還是燒烤？');
  assert.equal(response.status, 200); assert.deepEqual(response.json(), { invalid: true });
});

test('unknown hosts and cross-origin calls are refused before Jev is called', async t => {
  const app = await setup(t, { key: 'k' });
  assert.equal((await app.request('/', { host: 'rebind.example:1234' })).status, 421);
  assert.equal((await app.vote({}, undefined, 'rebind.example')).status, 421);
  assert.equal((await app.vote({ Origin: 'https://evil.example' })).status, 403);
  assert.equal((await app.vote({ Origin: 'null' })).status, 403);
  assert.deepEqual(app.keys, []);
  for (const host of [`127.0.0.1:${app.port}`, `[::1]:${app.port}`]) assert.equal((await app.request('/', { host })).status, 200);
});

test('ALLOWED_HOSTS adds host names for LAN or public deployments', async t => {
  const app = await setup(t, { key: 'k', allowedHosts: [' Magi.Example.com ', ''] });
  assert.equal((await app.request('/', { host: 'magi.example.com' })).status, 200);
  assert.equal((await app.vote({}, undefined, 'magi.example.com')).status, 200);
  assert.equal((await app.request('/', { host: 'other.example.com' })).status, 421);
});

test('malformed requests are rejected without calling Jev', async t => {
  const app = await setup(t, { key: 'k' });
  assert.equal((await app.vote({ 'Content-Type': 'text/plain' })).status, 415);
  assert.equal((await app.vote({}, '   ')).status, 400);
  assert.equal((await app.vote({}, 'x'.repeat(1201))).status, 400);
  assert.equal((await app.request('/api/evaluate', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: 'x'.repeat(16001) })).status, 413);
  assert.equal((await app.request('/api/evaluate')).status, 405);
  assert.equal((await app.vote({ 'X-TypeSafe-Key': 'bad key' })).status, 400);
  assert.deepEqual(app.keys, []);
});

test('Jev failures map to clear statuses without leaking provider details', async t => {
  let failure;
  const app = await setup(t, { key: 'k', evaluate: async () => { throw failure; } });
  failure = new JevError('invalid', 401);
  const server = await app.vote(); assert.equal(server.status, 401); assert.match(server.json().error, /伺服器設定/);
  const page = await app.vote({ 'X-TypeSafe-Key': pageKey }); assert.equal(page.status, 401); assert.match(page.json().error, /這個 API Key/);
  failure = new JevError('Jev 暫時無法完成議決，請稍後再試。', 429);
  assert.equal((await app.vote()).status, 429);
  failure = new Error('secret upstream body');
  const hidden = await app.vote(); assert.equal(hidden.status, 502); assert.ok(!hidden.text.includes('secret'));
});

test('a server key with invalid characters is rejected at startup', () => {
  assert.throws(() => createMagiServer({ key: 'bad key', publicDir: '/nonexistent' }), /invalid characters/);
});
