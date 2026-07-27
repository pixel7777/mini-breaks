// /api/fetch?url=<encoded>[&format=html] — authenticated outbound fetch relay.
//
// Auth: valid session cookie (the app) OR Bearer API_TOKEN (the overnight
// agent) — same as /api/data/*, with one deliberate difference: _lib.js's
// isAuthorized falls OPEN when neither secret is configured, which is right for
// a personal data store and wrong for an outbound fetcher. This route returns
// 503 in that state instead.

import { isAuthorized } from '../_lib.js';
import { relayFetch, validateTarget, htmlWrap } from '../_relay.js';

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}

export async function onRequest(context) {
  const { request, env } = context;

  if (request.method !== 'GET') return json({ error: 'method-not-allowed' }, 405);
  if (!env.API_TOKEN && !env.APP_PASSWORD) return json({ error: 'relay-not-configured' }, 503);
  if (!(await isAuthorized(request, env))) return json({ error: 'unauthorized' }, 401);

  const params = new URL(request.url).searchParams;
  const target = params.get('url');
  const asHtml = params.get('format') === 'html';

  const pre = validateTarget(target);
  if (!pre.ok) return json({ error: pre.error }, 400);

  const res = await relayFetch(pre.url);
  if (!res.ok) return json({ error: res.error, detail: res.detail }, res.status || 502);

  const headers = {
    'X-Relay-Status': String(res.status),
    'X-Relay-Url': res.url,
    'X-Relay-Truncated': res.truncated ? '1' : '0',
    'Cache-Control': 'no-store',
  };

  if (asHtml) {
    return new Response(htmlWrap(res.text, res.url), {
      headers: { ...headers, 'Content-Type': 'text/html; charset=utf-8' },
    });
  }
  return new Response(res.text, { headers: { ...headers, 'Content-Type': res.contentType } });
}
