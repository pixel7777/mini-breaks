// Outbound fetch relay helpers, shared by /api/fetch and /api/news (Cycle 05).
//
// Why this exists: the overnight agent's own fetch tool refuses URLs it
// constructed itself and discards XML bodies, which killed the Google News RSS
// rung and every product/API probe. The agent can already reach this app (it
// writes the digest here nightly), so the app fetches on its behalf.
//
// The relay is authenticated and deliberately narrow: GET only, http(s) only,
// no private/loopback/link-local/metadata targets, redirects re-validated at
// every hop, size-capped and time-boxed.
//
// Residual risk, accepted: a public hostname whose DNS resolves to a private
// address can't be caught here — a Worker has no resolver access. The bearer
// token is the compensating control.

export const MAX_BYTES = 2 * 1024 * 1024;
export const TIMEOUT_MS = 15000;
export const MAX_REDIRECTS = 3;
export const USER_AGENT =
  'Mozilla/5.0 (compatible; MiniBreaksRelay/1.0; +https://mini-breaks.pages.dev)';

const BLOCKED_EXACT = new Set(['localhost', 'metadata.google.internal', '0.0.0.0', '[::]']);
const BLOCKED_SUFFIX = ['.localhost', '.internal', '.local'];

function isBlockedIpv4(host) {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (!m) return false;
  const [a, b] = [Number(m[1]), Number(m[2])];
  // A malformed dotted quad is refused rather than passed through.
  if (m.slice(1).some(n => Number(n) > 255)) return true;
  if (a === 0 || a === 10 || a === 127) return true;
  if (a === 169 && b === 254) return true;          // link-local (incl. cloud metadata)
  if (a === 172 && b >= 16 && b <= 31) return true; // 172.16/12
  if (a === 192 && b === 168) return true;
  return false;
}

function isBlockedIpv6(host) {
  const h = host.replace(/^\[/, '').replace(/\]$/, '');
  if (!h.includes(':')) return false;
  if (h === '::1' || h === '::') return true;
  if (/^f[cd][0-9a-f]{2}:/i.test(h)) return true;   // fc00::/7 unique-local
  if (/^fe[89ab][0-9a-f]:/i.test(h)) return true;   // fe80::/10 link-local
  return false;
}

export function isBlockedHost(hostname) {
  const h = String(hostname || '').toLowerCase();
  if (!h) return true;
  if (BLOCKED_EXACT.has(h)) return true;
  if (BLOCKED_SUFFIX.some(s => h.endsWith(s))) return true;
  return isBlockedIpv4(h) || isBlockedIpv6(h);
}

// Resolve a caller-supplied target into a safe absolute URL, or an error code.
export function validateTarget(raw) {
  if (raw === null || raw === undefined || String(raw).trim() === '') {
    return { ok: false, error: 'missing-url' };
  }
  let u;
  try {
    u = new URL(String(raw).trim());
  } catch {
    return { ok: false, error: 'bad-url' };
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return { ok: false, error: 'bad-scheme' };
  if (isBlockedHost(u.hostname)) return { ok: false, error: 'blocked-host' };
  return { ok: true, url: u.toString() };
}

export function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

// Render an arbitrary payload as a plain HTML page. This is what makes a JSON
// or XML response readable by a fetcher that only extracts HTML.
export function htmlWrap(text, title = 'Relay') {
  return '<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><title>'
    + escapeHtml(title)
    + '</title></head><body><pre>'
    + escapeHtml(text)
    + '</pre></body></html>';
}

// Read a response body, stopping at maxBytes so an oversized target can never
// be buffered whole.
export async function readCapped(response, maxBytes = MAX_BYTES) {
  const body = response.body;
  if (!body || typeof body.getReader !== 'function') {
    const text = await response.text();
    return text.length > maxBytes
      ? { text: text.slice(0, maxBytes), truncated: true }
      : { text, truncated: false };
  }
  const reader = body.getReader();
  const chunks = [];
  let total = 0;
  let truncated = false;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    const chunk = value instanceof Uint8Array ? value : new Uint8Array(value);
    if (total + chunk.byteLength > maxBytes) {
      chunks.push(chunk.slice(0, maxBytes - total));
      truncated = true;
      try { await reader.cancel(); } catch { /* already closed */ }
      break;
    }
    chunks.push(chunk);
    total += chunk.byteLength;
  }
  const merged = new Uint8Array(chunks.reduce((n, c) => n + c.byteLength, 0));
  let off = 0;
  for (const c of chunks) { merged.set(c, off); off += c.byteLength; }
  return { text: new TextDecoder().decode(merged), truncated };
}

// Fetch a target with every guard applied. Redirects are followed manually so
// each hop is re-validated — otherwise a public URL could redirect into the
// private range the host check exists to block.
export async function relayFetch(rawUrl, opts = {}) {
  const maxBytes = opts.maxBytes ?? MAX_BYTES;
  const maxRedirects = opts.maxRedirects ?? MAX_REDIRECTS;
  const timeoutMs = opts.timeoutMs ?? TIMEOUT_MS;

  const first = validateTarget(rawUrl);
  if (!first.ok) return { ok: false, error: first.error, status: 400 };

  let url = first.url;
  for (let hop = 0; hop <= maxRedirects; hop++) {
    let res;
    try {
      res = await fetch(url, {
        method: 'GET',
        redirect: 'manual',
        signal: AbortSignal.timeout(timeoutMs),
        headers: { 'User-Agent': USER_AGENT, Accept: opts.accept || '*/*' },
      });
    } catch (e) {
      return { ok: false, error: 'fetch-failed', detail: String((e && e.message) || e), status: 502 };
    }

    if (res.status >= 300 && res.status < 400) {
      const loc = res.headers.get('Location');
      if (!loc) return { ok: false, error: 'redirect-without-location', status: 502 };
      let next;
      try { next = new URL(loc, url).toString(); } catch { return { ok: false, error: 'bad-redirect', status: 502 }; }
      const check = validateTarget(next);
      if (!check.ok) return { ok: false, error: 'blocked-redirect', status: 400 };
      url = check.url;
      continue;
    }

    const { text, truncated } = await readCapped(res, maxBytes);
    return {
      ok: true,
      status: res.status,
      url,
      contentType: res.headers.get('Content-Type') || 'text/plain; charset=utf-8',
      text,
      truncated,
    };
  }
  return { ok: false, error: 'too-many-redirects', status: 502 };
}
