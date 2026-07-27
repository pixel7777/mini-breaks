// Google News RSS support for /api/news (Cycle 05).
//
// The parsing lives here, server-side, on purpose: the overnight agent's fetch
// tool discards XML bodies, so handing it a feed to parse was never going to
// work. The Worker parses and returns JSON instead.
//
// Workers have no DOMParser, and a feed is not worth a dependency, so this is a
// small tolerant string parser. Malformed input yields [] rather than throwing —
// a bad feed should degrade to "no items", never take the run down.

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };

export function decodeXml(s) {
  return String(s)
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&#(\d+);/g, (_, d) => {
      try { return String.fromCodePoint(Number(d)); } catch { return _; }
    })
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => {
      try { return String.fromCodePoint(parseInt(h, 16)); } catch { return _; }
    })
    .replace(/&(amp|lt|gt|quot|apos);/g, (_, n) => ENTITIES[n]);
}

function tagText(block, name) {
  const re = new RegExp('<' + name + '(?:\\s[^>]*)?>([\\s\\S]*?)<\\/' + name + '>', 'i');
  const m = re.exec(block);
  return m ? decodeXml(m[1]).trim() : '';
}

// Extract the items from an RSS document.
export function parseRssItems(xml) {
  if (typeof xml !== 'string' || !xml) return [];
  const items = [];
  const re = /<item(?:\s[^>]*)?>([\s\S]*?)<\/item>/gi;
  let m;
  while ((m = re.exec(xml)) !== null) {
    const block = m[1];
    const title = tagText(block, 'title');
    const link = tagText(block, 'link');
    if (!title && !link) continue;
    items.push({
      title,
      link,
      published: tagText(block, 'pubDate') || null,
      source: tagText(block, 'source') || null,
    });
  }
  return items;
}

// Bing's news search also publishes RSS, and — unlike Google — it answers
// Cloudflare's egress IPs reliably (12/12 on the live deployment, 2026-07-27,
// while Google 503'd most requests from the same place). It is the fallback
// provider, not a replacement: Google's coverage and locale control are better
// when it deigns to answer.
//
// Bing's freshness filter is coarse — interval 4 is the past day, 7 the past
// week — so the agent's publish-date gate stays the real freshness control.
export function buildBingNewsUrl(opts = {}) {
  const { q, when = '1d' } = opts;
  const query = String(q || '').trim();
  if (!query) return null;
  const params = new URLSearchParams({ q: query, format: 'RSS' });
  params.set('qft', 'interval="' + (when === '1d' ? '4' : '7') + '"');
  return 'https://www.bing.com/news/search?' + params.toString();
}

// Build a Google News search-feed URL. `when` is the freshness filter the
// runbook relies on (1d normally, 2d after a missed night); the Croatian
// variant is simply hl=hr / gl=HR / ceid=HR:hr.
export function buildGoogleNewsUrl(opts = {}) {
  const {
    q, when = '1d', hl = 'en-US', gl = 'US', ceid = 'US:en',
  } = opts;
  const query = String(q || '').trim();
  if (!query) return null;
  const full = when ? query + ' when:' + when : query;
  const params = new URLSearchParams({ q: full, hl, gl, ceid });
  return 'https://news.google.com/rss/search?' + params.toString();
}
