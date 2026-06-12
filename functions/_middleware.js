// Password gate for the whole site.
// - APP_PASSWORD unset  -> fail open (pre-setup mode; see Cloudflare Setup Runbook).
// - /api/*              -> passed through; the API functions enforce cookie-or-bearer auth.
// - /auth/login         -> passed through (the login form's POST target).
// - everything else     -> requires a valid session cookie, else serves the login page.

import { verifyAuthCookie, loginPageHtml } from './_lib.js';

export async function onRequest(context) {
  const { request, env, next } = context;

  if (!env.APP_PASSWORD) return next();

  const url = new URL(request.url);
  if (url.pathname.startsWith('/api/') || url.pathname === '/auth/login') {
    return next();
  }

  if (await verifyAuthCookie(request, env.APP_PASSWORD)) {
    return next();
  }

  return new Response(loginPageHtml(url.searchParams.has('bad')), {
    status: 401,
    headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}
