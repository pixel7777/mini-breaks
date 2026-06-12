import { test } from 'node:test';
import assert from 'node:assert/strict';

import { onRequest as api } from '../functions/api/data/[key].js';
import { makeAuthCookieValue } from '../functions/_lib.js';

const PASSWORD = 'pw';
const TOKEN = 'agent-token';

function mockKV(initial = {}) {
  const store = new Map(Object.entries(initial));
  return {
    store,
    async get(k) { return store.has(k) ? store.get(k) : null; },
    async put(k, v) { store.set(k, v); },
    async delete(k) { store.delete(k); },
  };
}

function apiReq(key, { method = 'GET', body, bearer, cookie } = {}) {
  const headers = {};
  if (bearer) headers['Authorization'] = `Bearer ${bearer}`;
  if (cookie) headers['Cookie'] = `mb_auth=${cookie}`;
  return new Request(`https://x/api/data/${key}`, { method, headers, body });
}

function ctx(request, env, key) {
  return { request, env, params: { key } };
}

function env(kv) {
  return { APP_PASSWORD: PASSWORD, API_TOKEN: TOKEN, DATA: kv };
}

// ── auth and availability ──

test('unauthenticated requests are rejected', async () => {
  const res = await api(ctx(apiReq('topics'), env(mockKV()), 'topics'));
  assert.equal(res.status, 401);
});

test('a 503 with a clear marker is returned when KV is not bound', async () => {
  const e = { APP_PASSWORD: PASSWORD, API_TOKEN: TOKEN }; // no DATA binding
  const res = await api(ctx(apiReq('topics', { bearer: TOKEN }), e, 'topics'));
  assert.equal(res.status, 503);
  assert.equal((await res.json()).error, 'storage-not-configured');
});

test('unknown keys 404 without touching auth or storage', async () => {
  const res = await api(ctx(apiReq('secrets'), env(mockKV()), 'secrets'));
  assert.equal(res.status, 404);
  assert.equal((await res.json()).error, 'unknown-key');
});

// ── round-trips, both auth paths ──

test('bearer-auth PUT then GET round-trips a document (the agent path)', async () => {
  const kv = mockKV();
  const doc = JSON.stringify({ generated: '2026-06-12', items: [] });
  const put = await api(ctx(apiReq('digest', { method: 'PUT', body: doc, bearer: TOKEN }), env(kv), 'digest'));
  assert.equal(put.status, 200);
  const get = await api(ctx(apiReq('digest', { bearer: TOKEN }), env(kv), 'digest'));
  assert.equal(get.status, 200);
  assert.deepEqual(await get.json(), { generated: '2026-06-12', items: [] });
});

test('cookie-auth PUT then GET round-trips a document (the app path)', async () => {
  const kv = mockKV();
  const cookie = await makeAuthCookieValue(PASSWORD);
  const doc = JSON.stringify({ version: 1, entries: { '2026-06-12': { text: 'hi', mood: 3 } } });
  const put = await api(ctx(apiReq('journal', { method: 'PUT', body: doc, cookie }), env(kv), 'journal'));
  assert.equal(put.status, 200);
  const get = await api(ctx(apiReq('journal', { cookie }), env(kv), 'journal'));
  assert.equal((await get.json()).entries['2026-06-12'].text, 'hi');
});

test('missing documents return 404 {missing:true}', async () => {
  const res = await api(ctx(apiReq('topics', { bearer: TOKEN }), env(mockKV()), 'topics'));
  assert.equal(res.status, 404);
  assert.equal((await res.json()).missing, true);
});

test('DELETE removes a document', async () => {
  const kv = mockKV({ 'data:tarot-2026-06-12': '{"hook":"x"}' });
  const del = await api(ctx(apiReq('tarot-2026-06-12', { method: 'DELETE', bearer: TOKEN }), env(kv), 'tarot-2026-06-12'));
  assert.equal(del.status, 200);
  assert.equal(kv.store.has('data:tarot-2026-06-12'), false);
});

// ── validation ──

test('non-JSON bodies are rejected', async () => {
  const res = await api(ctx(apiReq('topics', { method: 'PUT', body: 'not json', bearer: TOKEN }), env(mockKV()), 'topics'));
  assert.equal(res.status, 400);
});

test('dated keys validate their shape', async () => {
  const kv = mockKV();
  const good = await api(ctx(apiReq('photo-2026-06-12', { method: 'PUT', body: '"data:image/jpeg;base64,xx"', bearer: TOKEN }), env(kv), 'photo-2026-06-12'));
  assert.equal(good.status, 200);
  const bad = await api(ctx(apiReq('photo-tomorrow', { bearer: TOKEN }), env(kv), 'photo-tomorrow'));
  assert.equal(bad.status, 404);
});

test('unsupported methods are rejected', async () => {
  const res = await api(ctx(apiReq('topics', { method: 'PATCH', body: '{}', bearer: TOKEN }), env(mockKV()), 'topics'));
  assert.equal(res.status, 405);
});
