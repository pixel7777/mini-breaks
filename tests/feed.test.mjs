import { test } from 'node:test';
import assert from 'node:assert/strict';

import { buildGoogleNewsUrl, buildBingNewsUrl, parseRssItems, decodeXml } from '../functions/_feed.js';

// ── feed URL construction ──

test('the freshness filter is appended to the query, and defaults are US english', () => {
  const u = new URL(buildGoogleNewsUrl({ q: 'new star trek series' }));
  assert.equal(u.origin + u.pathname, 'https://news.google.com/rss/search');
  assert.equal(u.searchParams.get('q'), 'new star trek series when:1d');
  assert.equal(u.searchParams.get('hl'), 'en-US');
  assert.equal(u.searchParams.get('gl'), 'US');
  assert.equal(u.searchParams.get('ceid'), 'US:en');
});

test('a missed night can widen the window', () => {
  const u = new URL(buildGoogleNewsUrl({ q: 'x', when: '2d' }));
  assert.equal(u.searchParams.get('q'), 'x when:2d');
});

test('the Croatian variant is just the locale triple', () => {
  const u = new URL(buildGoogleNewsUrl({ q: 'Zadar', hl: 'hr', gl: 'HR', ceid: 'HR:hr' }));
  assert.equal(u.searchParams.get('hl'), 'hr');
  assert.equal(u.searchParams.get('gl'), 'HR');
  assert.equal(u.searchParams.get('ceid'), 'HR:hr');
});

test('special characters in a query survive encoding', () => {
  const u = new URL(buildGoogleNewsUrl({ q: 'Angie\'s Actives & "gloss"' }));
  assert.equal(u.searchParams.get('q'), 'Angie\'s Actives & "gloss" when:1d');
});

test('an empty query yields no url', () => {
  assert.equal(buildGoogleNewsUrl({ q: '' }), null);
  assert.equal(buildGoogleNewsUrl({}), null);
  assert.equal(buildGoogleNewsUrl(), null);
});

test('when can be suppressed entirely', () => {
  const u = new URL(buildGoogleNewsUrl({ q: 'x', when: '' }));
  assert.equal(u.searchParams.get('q'), 'x');
});

// ── entity / CDATA decoding ──

test('decodeXml unwraps CDATA and decodes named and numeric entities', () => {
  assert.equal(decodeXml('<![CDATA[Bell & Co]]>'), 'Bell & Co');
  assert.equal(decodeXml('a &amp; b &lt;c&gt; &quot;d&quot; &apos;e&apos;'), 'a & b <c> "d" \'e\'');
  assert.equal(decodeXml('caf&#233;'), 'café');
  assert.equal(decodeXml('caf&#xE9;'), 'café');
});

// ── item extraction ──

const FEED = `<?xml version="1.0"?><rss version="2.0"><channel>
<title>Google News</title>
<item>
  <title><![CDATA[Star Trek: something new &amp; bold]]></title>
  <link>https://news.google.com/rss/articles/ABC123</link>
  <pubDate>Sun, 27 Jul 2026 06:12:00 GMT</pubDate>
  <source url="https://variety.com">Variety</source>
</item>
<item>
  <title>Second story</title>
  <link>https://news.google.com/rss/articles/DEF456</link>
</item>
</channel></rss>`;

test('items are extracted with title, link, date and source', () => {
  const items = parseRssItems(FEED);
  assert.equal(items.length, 2);
  assert.equal(items[0].title, 'Star Trek: something new & bold');
  assert.equal(items[0].link, 'https://news.google.com/rss/articles/ABC123');
  assert.equal(items[0].published, 'Sun, 27 Jul 2026 06:12:00 GMT');
  assert.equal(items[0].source, 'Variety');
});

test('an item missing a date or source yields nulls, not omissions', () => {
  const items = parseRssItems(FEED);
  assert.equal(items[1].title, 'Second story');
  assert.equal(items[1].published, null);
  assert.equal(items[1].source, null);
});

test('the channel title is not mistaken for an item', () => {
  const items = parseRssItems(FEED);
  assert.ok(!items.some(i => i.title === 'Google News'));
});

test('an empty feed yields no items', () => {
  assert.deepEqual(parseRssItems('<rss><channel><title>x</title></channel></rss>'), []);
});

test('malformed or non-string input degrades to an empty list rather than throwing', () => {
  assert.deepEqual(parseRssItems('<rss><item><title>unclosed'), []);
  assert.deepEqual(parseRssItems(''), []);
  assert.deepEqual(parseRssItems(null), []);
  assert.deepEqual(parseRssItems(undefined), []);
  assert.deepEqual(parseRssItems(42), []);
});

test('an item with neither a title nor a link is skipped', () => {
  const items = parseRssItems('<rss><item><pubDate>x</pubDate></item></rss>');
  assert.deepEqual(items, []);
});

// ── Bing fallback provider ──

test('the Bing feed url carries the query, RSS format and a freshness interval', () => {
  const u = new URL(buildBingNewsUrl({ q: 'star trek', when: '1d' }));
  assert.equal(u.origin + u.pathname, 'https://www.bing.com/news/search');
  assert.equal(u.searchParams.get('q'), 'star trek');
  assert.equal(u.searchParams.get('format'), 'RSS');
  assert.equal(u.searchParams.get('qft'), 'interval="4"');
});

test('a wider window asks Bing for the past week', () => {
  const u = new URL(buildBingNewsUrl({ q: 'x', when: '2d' }));
  assert.equal(u.searchParams.get('qft'), 'interval="7"');
});

test('an empty query yields no Bing url either', () => {
  assert.equal(buildBingNewsUrl({ q: '' }), null);
  assert.equal(buildBingNewsUrl(), null);
});

test('the same parser reads a Bing feed', () => {
  const items = parseRssItems('<rss><channel><item><title>B</title><link>https://b/1</link><pubDate>Sun, 26 Jul 2026 10:00:00 GMT</pubDate></item></channel></rss>');
  assert.equal(items.length, 1);
  assert.equal(items[0].title, 'B');
});
