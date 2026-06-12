// Shared auth helpers for Mini Breaks Pages Functions.
// Cookie format: "<expiryEpochSeconds>.<hexHmac>" where the HMAC is over
// "mb-auth-v1:<expiry>" keyed by APP_PASSWORD. No external dependencies.

const COOKIE_NAME = 'mb_auth';
const COOKIE_MAX_AGE = 60 * 60 * 24 * 60; // 60 days
const SIGN_PREFIX = 'mb-auth-v1:';

async function hmacHex(secret, message) {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(message));
  return [...new Uint8Array(sig)].map(b => b.toString(16).padStart(2, '0')).join('');
}

export async function makeAuthCookieValue(password, nowSeconds) {
  const exp = (nowSeconds ?? Math.floor(Date.now() / 1000)) + COOKIE_MAX_AGE;
  const sig = await hmacHex(password, SIGN_PREFIX + exp);
  return `${exp}.${sig}`;
}

export function authCookieHeader(value) {
  return `${COOKIE_NAME}=${value}; Max-Age=${COOKIE_MAX_AGE}; Path=/; HttpOnly; Secure; SameSite=Lax`;
}

export function getCookie(request, name = COOKIE_NAME) {
  const header = request.headers.get('Cookie') || '';
  for (const part of header.split(';')) {
    const [k, ...rest] = part.trim().split('=');
    if (k === name) return rest.join('=');
  }
  return null;
}

export async function verifyAuthCookie(request, password, nowSeconds) {
  const value = getCookie(request);
  if (!value) return false;
  const dot = value.indexOf('.');
  if (dot < 1) return false;
  const exp = value.slice(0, dot);
  const sig = value.slice(dot + 1);
  if (!/^\d+$/.test(exp)) return false;
  const now = nowSeconds ?? Math.floor(Date.now() / 1000);
  if (parseInt(exp, 10) < now) return false;
  const expected = await hmacHex(password, SIGN_PREFIX + exp);
  // Compare HMACs of equal length; timing leak is not in the threat model here,
  // but compare full strings without early exit anyway.
  if (expected.length !== sig.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) diff |= expected.charCodeAt(i) ^ sig.charCodeAt(i);
  return diff === 0;
}

export function getBearerToken(request) {
  const h = request.headers.get('Authorization') || '';
  if (h.startsWith('Bearer ')) return h.slice(7).trim();
  return null;
}

// True when the request is authenticated for app/API use:
// a valid session cookie, or the agent's bearer token.
export async function isAuthorized(request, env) {
  const bearer = getBearerToken(request);
  if (bearer && env.API_TOKEN && bearer === env.API_TOKEN) return true;
  if (env.APP_PASSWORD) return verifyAuthCookie(request, env.APP_PASSWORD);
  // Pre-setup mode: no password configured yet — allow, so the app works
  // out of the box until Heidi finishes the Cloudflare runbook.
  return true;
}

export function loginPageHtml(bad) {
  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Mini Breaks</title>
<style>
body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;
background:#f6fbfb;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;color:#1f3a3d}
.box{background:#fff;border:1px solid #dceeee;border-radius:12px;padding:32px 36px;
box-shadow:0 1px 3px rgba(31,58,61,.06);text-align:center;max-width:320px}
h1{font-size:20px;margin:0 0 6px;color:#1f3a3d}
p{font-size:13px;color:#5a7374;margin:0 0 18px}
input{width:100%;box-sizing:border-box;padding:10px 12px;border:1px solid #dceeee;border-radius:8px;
font-size:15px;margin-bottom:12px}
input:focus{outline:none;border-color:#2a9d8f}
button{width:100%;padding:10px;background:#2a9d8f;color:#fff;border:none;border-radius:8px;
font-size:15px;font-weight:500;cursor:pointer}
button:hover{background:#228075}
.bad{color:#c45a4f;font-size:13px;margin:0 0 10px}
</style></head><body>
<div class="box">
<h1>Mini Breaks</h1>
<p>This page is private.</p>
${bad ? '<p class="bad">That password didn’t match — try again.</p>' : ''}
<form method="POST" action="/auth/login">
<input type="password" name="password" placeholder="Password" autofocus autocomplete="current-password">
<button type="submit">Enter</button>
</form>
</div>
</body></html>`;
}
