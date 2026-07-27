// /api/news?q=<query>[&when&hl&gl&ceid][&format=html] — the Google News RSS
// rung of the overnight ladder, fetched and PARSED server-side so the agent
// receives JSON instead of an XML body its own fetch tool would discard.
//
// Same auth posture as /api/fetch (see the note there about the 503).

import { isAuthorized } from '../_lib.js';
import { relayFetch, escapeHtml } from '../_relay.js';
import { buildGoogleNewsUrl, parseRssItems } from '../_feed.js';

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

  const feedUrl = buildGoogleNewsUrl({
    q: query,
    when: params.get('when') ?? '1d',
    hl: params.get('hl') ?? 'en-US',
    gl: params.get('gl') ?? 'US',
    ceid: params.get('ceid') ?? 'US:en',
  });
  if (!feedUrl) return json({ error: 'missing-query' }, 400);

  // Retries matter here: Google 503s a Cloudflare egress IP most of the time and
  // succeeds on a retry. Without this the rung looks dead when it is only busy.
  const res = await relayFetch(feedUrl, {
    accept: 'application/rss+xml, application/xml, text/xml, */*',
    retries: 3,
  });
  if (!res.ok) return json({ error: res.error, detail: res.detail, feedUrl }, res.status || 502);
  if (res.status >= 400) return json({ error: 'feed-unavailable', upstreamStatus: res.status, feedUrl }, 502);

  const items = parseRssItems(res.text);

  if (asHtml) {
    return new Response(itemsAsHtml(query, feedUrl, items), {
      headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' },
    });
  }
  return json({ query, feedUrl, count: items.length, truncated: res.truncated, items });
}
