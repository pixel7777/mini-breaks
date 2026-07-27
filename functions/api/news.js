// /api/news?q=<query>[&when&hl&gl&ceid][&format=html] — the Google News RSS
// rung of the overnight ladder, fetched and PARSED server-side so the agent
// receives JSON instead of an XML body its own fetch tool would discard.
//
// Same auth posture as /api/fetch (see the note there about the 503).

import { isAuthorized } from '../_lib.js';
import { relayFetch, escapeHtml } from '../_relay.js';
import { buildGoogleNewsUrl, buildBingNewsUrl, parseRssItems } from '../_feed.js';

const FEED_ACCEPT = 'application/rss+xml, application/xml, text/xml, */*';

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}

function itemsAsHtml(query, feedUrl, items) {
  const rows = items.map(i =>
    '<li><a href="' + escapeHtml(i.link) + '">' + escapeHtml(i.title) + '</a>'
    + (i.source ? ' &mdash; ' + escapeHtml(i.source) : '')
    + (i.published ? ' <em>' + escapeHtml(i.published) + '</em>' : '')
    + '</li>'
  ).join('');
  return '<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><title>'
    + escapeHtml(query) + '</title></head><body><h1>' + escapeHtml(query) + '</h1>'
    + '<p>' + escapeHtml(feedUrl) + '</p><ul>' + rows + '</ul></body></html>';
}

export async function onRequest(context) {
  const { request, env } = context;

  if (request.method !== 'GET') return json({ error: 'method-not-allowed' }, 405);
  if (!env.API_TOKEN && !env.APP_PASSWORD) return json({ error: 'relay-not-configured' }, 503);
  if (!(await isAuthorized(request, env))) return json({ error: 'unauthorized' }, 401);

  const params = new URL(request.url).searchParams;
  const query = params.get('q');
  const asHtml = params.get('format') === 'html';

  const when = params.get('when') ?? '1d';

  // Provider ladder. Google first — better coverage and real locale control —
  // but it rate-limits Cloudflare's egress hard, so Bing backs it up rather than
  // letting a busy Google read as "no news".
  const providers = [
    {
      name: 'google',
      url: buildGoogleNewsUrl({
        q: query,
        when,
        hl: params.get('hl') ?? 'en-US',
        gl: params.get('gl') ?? 'US',
        ceid: params.get('ceid') ?? 'US:en',
      }),
    },
    { name: 'bing', url: buildBingNewsUrl({ q: query, when }) },
  ].filter(p => p.url);

  if (!providers.length) return json({ error: 'missing-query' }, 400);

  const attempts = [];
  let served = null;
  for (const p of providers) {
    const res = await relayFetch(p.url, {
      accept: FEED_ACCEPT, retries: 1, retryDelays: [400], timeoutMs: 8000,
    });
    if (!res.ok || res.status >= 400) {
      attempts.push({ provider: p.name, status: res.status ?? null, error: res.error ?? 'upstream' });
      continue;
    }
    const items = parseRssItems(res.text);
    attempts.push({ provider: p.name, status: res.status, count: items.length });
    // Remember the first provider that answered, but keep going for one that
    // actually has stories — an empty feed is an answer, just not a useful one.
    if (!served) served = { provider: p.name, feedUrl: p.url, items, truncated: res.truncated };
    if (items.length) { served = { provider: p.name, feedUrl: p.url, items, truncated: res.truncated }; break; }
  }

  if (!served) return json({ error: 'feed-unavailable', attempts }, 502);

  if (asHtml) {
    return new Response(itemsAsHtml(query, served.feedUrl, served.items), {
      headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' },
    });
  }
  return json({
    query,
    provider: served.provider,
    feedUrl: served.feedUrl,
    count: served.items.length,
    truncated: served.truncated,
    attempts,
    items: served.items,
  });
}
