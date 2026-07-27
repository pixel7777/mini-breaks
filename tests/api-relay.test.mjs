import { test } from 'node:test';
import assert from 'node:assert/strict';

import { onRequest as fetchRoute } from '../functions/api/fetch.js';
import { onRequest as newsRoute } from '../functions/api/news.js';
import { makeAuthCookieValue } from '../functions/_lib.js';

const PASSWORD = 'pw';
const TOKEN = 'agent-token';

function req(path, { method = 'GET', bearer, cookie } = {}) {
  const headers = {};
  if (bearer) headers['Authorization'] = `Bearer ${bearer}`;
  if (cookie) headers['Cookie'] = `mb_auth=${cookie}`;
  return new Request('https://x' + path, { method, headers });
}

const env = () => ({ APP_PASSWORD: PASSWORD, API_TOKEN: TOKEN });

function withStubbedFetch(handler, fn) {
  const real = globalThis.fetch;
  globalThis.fetch = handler;
  return fn().finally(() => { globalThis.fetch = real; });
}

const ok = (body, ct = 'text/plain') =>
  async () => new Response(body, { status: 200, headers: { 'Content-Type': ct } });

// ── auth and method posture ──

test('the relay rejects unauthenticated callers', async () => {
  const res = await fetchRoute({ request: req('/api/fetch?url=https://a.com/'), env: env() });
  assert.equal(res.status, 401);
});

test('the relay refuses to run at all when no secret is configured', async () => {
  // _lib.js isAuthorized deliberately fails OPEN pre-setup; that is safe for a
  // personal data store and unsafe for an outbound fetcher, so this route 503s.
  const res = await fetchRoute({ request: req('/api/fetch?url=https://a.com/'), env: {} });
  assert.equal(res.status, 503);
  assert.equal((await res.json()).error, 'relay-not-configured');
});

test('the relay is GET-only', async () => {
  const res = await fetchRoute({ request: req('/api/fetch?url=https://a.com/', { method: 'POST', bearer: TOKEN }), env: env() });
  assert.equal(res.status, 405);
});

test('a session cookie authenticates the relay as well as the bearer token', async () => {
  const cookie = await makeAuthCookieValue(PASSWORD);
  await withStubbedFetch(ok('hi'), async () => {
    const res = await fetchRoute({ request: req('/api/fetch?url=https://a.com/', { cookie }), env: env() });
    assert.equal(res.status, 200);
  });
});

// ── /api/fetch behavior ──

test('a target is passed through with its status, body and content-type', async () => {
  await withStubbedFetch(ok('{"price":32.95}', 'application/json'), async () => {
    const res = await fetchRoute({ request: req('/api/fetch?url=https://shop.hr/wp-json/wc/store/v1/products', { bearer: TOKEN }), env: env() });
    assert.equal(res.status, 200);
    assert.match(res.headers.get('Content-Type'), /application\/json/);
    assert.equal(res.headers.get('X-Relay-Status'), '200');
    assert.equal(res.headers.get('X-Relay-Truncated'), '0');
    assert.equal(await res.text(), '{"price":32.95}');
  });
});

test('format=html wraps any payload so an HTML-only reader can see it', async () => {
  await withStubbedFetch(ok('{"a":1}', 'application/json'), async () => {
    const res = await fetchRoute({ request: req('/api/fetch?url=https://shop.hr/x&format=html', { bearer: TOKEN }), env: env() });
    assert.match(res.headers.get('Content-Type'), /text\/html/);
    const body = await res.text();
    assert.match(body, /^<!DOCTYPE html>/);
    assert.match(body, /<pre>\{&quot;a&quot;:1\}<\/pre>/);
  });
});

test('each validation failure surfaces its own code', async () => {
  const cases = [
    ['/api/fetch', 'missing-url'],
    ['/api/fetch?url=nonsense', 'bad-url'],
    ['/api/fetch?url=' + encodeURIComponent('file:///etc/passwd'), 'bad-scheme'],
    ['/api/fetch?url=' + encodeURIComponent('http://169.254.169.254/latest/'), 'blocked-host'],
  ];
  for (const [path, error] of cases) {
    const res = await fetchRoute({ request: req(path, { bearer: TOKEN }), env: env() });
    assert.equal(res.status, 400, path);
    assert.equal((await res.json()).error, error, path);
  }
});

test('an upstream transport failure becomes a 502, not a crash', async () => {
  await withStubbedFetch(async () => { throw new Error('dns'); }, async () => {
    const res = await fetchRoute({ request: req('/api/fetch?url=https://gone.example/', { bearer: TOKEN }), env: env() });
    assert.equal(res.status, 502);
    assert.equal((await res.json()).error, 'fetch-failed');
  });
});

// ── /api/news behavior ──

const FEED = `<rss><channel><item><title>Headline one</title>
<link>https://news.google.com/rss/articles/A</link>
<pubDate>Sun, 27 Jul 2026 06:00:00 GMT</pubDate><source url="https://x">Variety</source></item></channel></rss>`;

test('the news route returns parsed items as JSON, never raw XML', async () => {
  await withStubbedFetch(ok(FEED, 'application/xml'), async () => {
    const res = await newsRoute({ request: req('/api/news?q=star+trek', { bearer: TOKEN }), env: env() });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.count, 1);
    assert.equal(body.items[0].title, 'Headline one');
    assert.equal(body.items[0].source, 'Variety');
    assert.match(body.feedUrl, /news\.google\.com\/rss\/search/);
    assert.match(body.feedUrl, /when%3A1d/);
  });
});

test('the news route honours the locale and freshness parameters', async () => {
  let seen = '';
  await withStubbedFetch(async (u) => { seen = u; return new Response(FEED, { status: 200 }); }, async () => {
    await newsRoute({ request: req('/api/news?q=Zadar&when=2d&hl=hr&gl=HR&ceid=HR%3Ahr', { bearer: TOKEN }), env: env() });
  });
  assert.match(seen, /hl=hr/);
  assert.match(seen, /gl=HR/);
  assert.match(seen, /ceid=HR%3Ahr/);
  assert.match(seen, /when%3A2d/);
});

test('the news route can render its items as plain HTML', async () => {
  await withStubbedFetch(ok(FEED, 'application/xml'), async () => {
    const res = await newsRoute({ request: req('/api/news?q=x&format=html', { bearer: TOKEN }), env: env() });
    assert.match(res.headers.get('Content-Type'), /text\/html/);
    const body = await res.text();
    assert.match(body, /<li><a href="https:\/\/news\.google\.com\/rss\/articles\/A">Headline one<\/a>/);
  });
});

test('a query is required', async () => {
  const res = await newsRoute({ request: req('/api/news', { bearer: TOKEN }), env: env() });
  assert.equal(res.status, 400);
  assert.equal((await res.json()).error, 'missing-query');
});

test('only when EVERY provider fails is it a 502, and the attempts are reported', async () => {
  await withStubbedFetch(async () => new Response('nope', { status: 429 }), async () => {
    const res = await newsRoute({ request: req('/api/news?q=x', { bearer: TOKEN }), env: env() });
    assert.equal(res.status, 502);
    const body = await res.json();
    assert.equal(body.error, 'feed-unavailable');
    assert.deepEqual(body.attempts.map(a => a.provider), ['google', 'bing']);
    assert.ok(body.attempts.every(a => a.status === 429));
  });
});

// ── the provider ladder ──
// Google rate-limits Cloudflare's egress hard (measured 2026-07-27), so a busy
// Google must not read as "no news" — Bing backs it up.

const BING_FEED = `<rss><channel><item><title>Bing headline</title>
<link>https://bing.example/a</link></item></channel></rss>`;

function byHost({ google, bing }) {
  return async (url) => (String(url).includes('news.google.com') ? google() : bing());
}

test('when Google refuses, Bing serves and the provider is reported', async () => {
  await withStubbedFetch(
    byHost({
      google: () => new Response('busy', { status: 503 }),
      bing: () => new Response(BING_FEED, { status: 200 }),
    }),
    async () => {
      const res = await newsRoute({ request: req('/api/news?q=x', { bearer: TOKEN }), env: env() });
      assert.equal(res.status, 200);
      const body = await res.json();
      assert.equal(body.provider, 'bing');
      assert.equal(body.count, 1);
      assert.equal(body.items[0].title, 'Bing headline');
      assert.match(body.feedUrl, /bing\.com\/news\/search/);
      assert.deepEqual(body.attempts.map(a => a.provider), ['google', 'bing']);
    },
  );
});

test('Google is preferred when it answers with stories — Bing is never called', async () => {
  let bingCalls = 0;
  await withStubbedFetch(
    byHost({
      google: () => new Response(FEED, { status: 200 }),
      bing: () => { bingCalls++; return new Response(BING_FEED, { status: 200 }); },
    }),
    async () => {
      const res = await newsRoute({ request: req('/api/news?q=x', { bearer: TOKEN }), env: env() });
      const body = await res.json();
      assert.equal(body.provider, 'google');
      assert.equal(bingCalls, 0);
    },
  );
});

test('an empty Google feed falls through to Bing rather than reporting no news', async () => {
  await withStubbedFetch(
    byHost({
      google: () => new Response('<rss><channel></channel></rss>', { status: 200 }),
      bing: () => new Response(BING_FEED, { status: 200 }),
    }),
    async () => {
      const res = await newsRoute({ request: req('/api/news?q=x', { bearer: TOKEN }), env: env() });
      const body = await res.json();
      assert.equal(body.provider, 'bing');
      assert.equal(body.count, 1);
    },
  );
});

test('when both providers are empty it is a genuine no-news, not an error', async () => {
  await withStubbedFetch(
    async () => new Response('<rss><channel></channel></rss>', { status: 200 }),
    async () => {
      const res = await newsRoute({ request: req('/api/news?q=x', { bearer: TOKEN }), env: env() });
      assert.equal(res.status, 200);
      const body = await res.json();
      assert.equal(body.count, 0);
      assert.deepEqual(body.items, []);
    },
  );
});

test('a feed that parses to nothing is an empty list, not an error', async () => {
  await withStubbedFetch(ok('<rss><channel></channel></rss>', 'application/xml'), async () => {
    const res = await newsRoute({ request: req('/api/news?q=x', { bearer: TOKEN }), env: env() });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.count, 0);
    assert.deepEqual(body.items, []);
  });
});
