// /api/data/<key> — tiny JSON store over Cloudflare KV (binding: DATA).
// Auth: valid session cookie (the app) OR Bearer API_TOKEN (the overnight agent).
// Keys are whitelisted; values are JSON documents stored as text.

import { isAuthorized } from '../../_lib.js';

const KEY_RE = /^(topics|digest|agent-state|journal|photo-\d{4}-\d{2}-\d{2}|tarot-\d{4}-\d{2}-\d{2})$/;
const MAX_BYTES = 4 * 1024 * 1024; // photos are client-resized well below this

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}

export async function onRequest(context) {
  const { request, env, params } = context;
  const key = String(params.key || '');

  if (!KEY_RE.test(key)) return json({ error: 'unknown-key' }, 404);

  if (!(await isAuthorized(request, env))) return json({ error: 'unauthorized' }, 401);

  if (!env.DATA) return json({ error: 'storage-not-configured' }, 503);

  const kvKey = 'data:' + key;

  if (request.method === 'GET') {
    const value = await env.DATA.get(kvKey);
    if (value === null) return json({ missing: true }, 404);
    return new Response(value, {
      headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
    });
  }

  if (request.method === 'PUT') {
    const text = await request.text();
    if (text.length > MAX_BYTES) return json({ error: 'too-large' }, 413);
    try { JSON.parse(text); } catch { return json({ error: 'not-json' }, 400); }
    await env.DATA.put(kvKey, text);
    return json({ ok: true });
  }

  if (request.method === 'DELETE') {
    await env.DATA.delete(kvKey);
    return json({ ok: true });
  }

  return json({ error: 'method-not-allowed' }, 405);
}
