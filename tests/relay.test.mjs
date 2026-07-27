import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  validateTarget, isBlockedHost, escapeHtml, htmlWrap, readCapped, relayFetch,
} from '../functions/_relay.js';

// ── target validation: the SSRF guard ──

test('ordinary public https and http targets are accepted', () => {
  assert.equal(validateTarget('https://news.google.com/rss/search?q=x').ok, true);
  assert.equal(validateTarget('http://example.hr/product/123').ok, true);
});

test('a missing or unparseable url is refused with a specific code', () => {
  assert.equal(validateTarget(null).error, 'missing-url');
  assert.equal(validateTarget('').error, 'missing-url');
  assert.equal(validateTarget('   ').error, 'missing-url');
  assert.equal(validateTarget('not a url').error, 'bad-url');
});

test('non-http schemes are refused', () => {
  for (const u of ['ftp://example.com/x', 'file:///etc/passwd', 'data:text/plain,hi']) {
    assert.equal(validateTarget(u).error, 'bad-scheme', u);
  }
});

test('loopback, private, link-local and metadata targets are refused', () => {
  const blocked = [
    'http://localhost/x',
    'http://app.localhost/x',
    'http://thing.internal/x',
    'http://printer.local/x',
    'http://metadata.google.internal/computeMetadata/v1/',
    'http://127.0.0.1/x',
    'http://127.9.9.9/x',
    'http://10.0.0.5/x',
    'http://172.16.0.1/x',
    'http://172.31.255.254/x',
    'http://192.168.1.1/x',
    'http://169.254.169.254/latest/meta-data/',
    'http://0.0.0.0/x',
    'http://[::1]/x',
    'http://[fc00::1]/x',
    'http://[fe80::1]/x',
  ];
  for (const u of blocked) assert.equal(validateTarget(u).error, 'blocked-host', u);
});

test('public addresses adjacent to blocked ranges are still allowed', () => {
  // 172.32/172.15 sit outside 172.16/12; 11.x and 192.169.x are public.
  for (const u of ['http://172.32.0.1/x', 'http://172.15.0.1/x', 'http://11.0.0.1/x', 'http://192.169.1.1/x']) {
    assert.equal(validateTarget(u).ok, true, u);
  }
});

test('a malformed dotted quad is refused rather than passed through', () => {
  assert.equal(isBlockedHost('999.1.1.1'), true);
});

// ── html rendering ──

test('escapeHtml neutralizes markup and quotes', () => {
  assert.equal(escapeHtml('<a href="x">&\'</a>'), '&lt;a href=&quot;x&quot;&gt;&amp;&#39;&lt;/a&gt;');
});

test('htmlWrap produces a page with the payload escaped inside pre', () => {
  const out = htmlWrap('{"a":"<b>"}', 'https://x/y');
  assert.match(out, /^<!DOCTYPE html>/);
  assert.match(out, /<pre>\{&quot;a&quot;:&quot;&lt;b&gt;&quot;\}<\/pre>/);
  assert.match(out, /<title>https:\/\/x\/y<\/title>/);
});

// ── size cap ──

function streamResponse(text) {
  const bytes = new TextEncoder().encode(text);
  return new Response(new ReadableStream({
    start(c) { c.enqueue(bytes); c.close(); },
  }));
}

test('readCapped returns a short body untruncated', async () => {
  const { text, truncated } = await readCapped(streamResponse('hello'), 1000);
  assert.equal(text, 'hello');
  assert.equal(truncated, false);
});

test('readCapped stops at the cap and flags truncation', async () => {
  const { text, truncated } = await readCapped(streamResponse('abcdefghij'), 4);
  assert.equal(text, 'abcd');
  assert.equal(truncated, true);
});

// ── relayFetch: redirects must not bypass the host guard ──

function withStubbedFetch(handler, fn) {
  const real = globalThis.fetch;
  globalThis.fetch = handler;
  return fn().finally(() => { globalThis.fetch = real; });
}

test('relayFetch returns the body, status and content-type of the target', async () => {
  await withStubbedFetch(
    async () => new Response('<rss/>', { status: 200, headers: { 'Content-Type': 'application/xml' } }),
    async () => {
      const res = await relayFetch('https://example.com/feed');
      assert.equal(res.ok, true);
      assert.equal(res.status, 200);
      assert.equal(res.text, '<rss/>');
      assert.match(res.contentType, /application\/xml/);
    },
  );
});

test('a redirect into the private range is refused, not followed', async () => {
  await withStubbedFetch(
    async () => new Response(null, { status: 302, headers: { Location: 'http://169.254.169.254/latest/' } }),
    async () => {
      const res = await relayFetch('https://example.com/start');
      assert.equal(res.ok, false);
      assert.equal(res.error, 'blocked-redirect');
      assert.equal(res.status, 400);
    },
  );
});

test('a redirect to another public host is followed', async () => {
  let call = 0;
  await withStubbedFetch(
    async (url) => {
      call++;
      if (call === 1) return new Response(null, { status: 301, headers: { Location: 'https://elsewhere.com/final' } });
      assert.equal(url, 'https://elsewhere.com/final');
      return new Response('landed', { status: 200 });
    },
    async () => {
      const res = await relayFetch('https://example.com/start');
      assert.equal(res.ok, true);
      assert.equal(res.text, 'landed');
      assert.equal(res.url, 'https://elsewhere.com/final');
    },
  );
});

test('a redirect loop terminates with too-many-redirects', async () => {
  await withStubbedFetch(
    async () => new Response(null, { status: 302, headers: { Location: 'https://example.com/loop' } }),
    async () => {
      const res = await relayFetch('https://example.com/loop', { maxRedirects: 2 });
      assert.equal(res.ok, false);
      assert.equal(res.error, 'too-many-redirects');
    },
  );
});

test('a transport failure is reported, not thrown', async () => {
  await withStubbedFetch(
    async () => { throw new Error('boom'); },
    async () => {
      const res = await relayFetch('https://example.com/x');
      assert.equal(res.ok, false);
      assert.equal(res.error, 'fetch-failed');
      assert.equal(res.status, 502);
    },
  );
});

test('relayFetch refuses a blocked target without calling fetch at all', async () => {
  let called = false;
  await withStubbedFetch(
    async () => { called = true; return new Response('x'); },
    async () => {
      const res = await relayFetch('http://127.0.0.1/x');
      assert.equal(res.error, 'blocked-host');
      assert.equal(called, false);
    },
  );
});

// ── retry: shared-IP rate limiting, not refusal ──

test('a 503 is retried and the eventual success is returned', async () => {
  let calls = 0;
  await withStubbedFetch(
    async () => {
      calls++;
      return calls < 3
        ? new Response('busy', { status: 503 })
        : new Response('<rss/>', { status: 200 });
    },
    async () => {
      const res = await relayFetch('https://news.google.com/rss/search?q=x', { retries: 3, retryDelays: [0] });
      assert.equal(res.ok, true);
      assert.equal(res.status, 200);
      assert.equal(res.text, '<rss/>');
      assert.equal(calls, 3);
    },
  );
});

test('a 403 bot-wall is NOT retried — it is a refusal, not congestion', async () => {
  let calls = 0;
  await withStubbedFetch(
    async () => { calls++; return new Response('<html>denied</html>', { status: 403 }); },
    async () => {
      const res = await relayFetch('https://mondialpharma.com/wp-json/', { retries: 3, retryDelays: [0] });
      assert.equal(res.status, 403);
      assert.equal(calls, 1);
    },
  );
});

test('retries are exhausted and the last failure is reported', async () => {
  let calls = 0;
  await withStubbedFetch(
    async () => { calls++; return new Response('busy', { status: 503 }); },
    async () => {
      const res = await relayFetch('https://x.com/', { retries: 2, retryDelays: [0] });
      assert.equal(res.status, 503);
      assert.equal(calls, 3); // one attempt + two retries
    },
  );
});

test('a transport failure is retried too', async () => {
  let calls = 0;
  await withStubbedFetch(
    async () => {
      calls++;
      if (calls === 1) throw new Error('reset');
      return new Response('ok', { status: 200 });
    },
    async () => {
      const res = await relayFetch('https://x.com/', { retries: 2, retryDelays: [0] });
      assert.equal(res.ok, true);
      assert.equal(res.text, 'ok');
    },
  );
});

test('with retries off, a 503 comes straight back (default behavior unchanged)', async () => {
  let calls = 0;
  await withStubbedFetch(
    async () => { calls++; return new Response('busy', { status: 503 }); },
    async () => {
      const res = await relayFetch('https://x.com/');
      assert.equal(res.status, 503);
      assert.equal(calls, 1);
    },
  );
});
