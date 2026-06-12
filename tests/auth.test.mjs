import { test } from 'node:test';
import assert from 'node:assert/strict';

import { makeAuthCookieValue, verifyAuthCookie, isAuthorized } from '../functions/_lib.js';
import { onRequest as middleware } from '../functions/_middleware.js';
import { onRequestPost as login } from '../functions/auth/login.js';

const PASSWORD = 'correct horse battery staple';

function req(url, { cookie, bearer, method = 'GET', body, contentType } = {}) {
  const headers = {};
  if (cookie) headers['Cookie'] = `mb_auth=${cookie}`;
  if (bearer) headers['Authorization'] = `Bearer ${bearer}`;
  if (contentType) headers['Content-Type'] = contentType;
  return new Request(url, { method, headers, body });
}

const NEXT_MARKER = new Response('next-was-called');

function ctx(request, env = {}) {
  return { request, env, next: async () => NEXT_MARKER.clone() };
}

// ── cookie round-trip ──

test('a freshly minted cookie verifies', async () => {
  const value = await makeAuthCookieValue(PASSWORD);
  assert.equal(await verifyAuthCookie(req('https://x/', { cookie: value }), PASSWORD), true);
});

test('an expired cookie does not verify', async () => {
  const past = Math.floor(Date.now() / 1000) - 60 * 60 * 24 * 90; // minted 90 days ago
  const value = await makeAuthCookieValue(PASSWORD, past);
  assert.equal(await verifyAuthCookie(req('https://x/', { cookie: value }), PASSWORD), false);
});

test('a cookie signed with the wrong password does not verify', async () => {
  const value = await makeAuthCookieValue('some-other-password');
  assert.equal(await verifyAuthCookie(req('https://x/', { cookie: value }), PASSWORD), false);
});

test('a tampered cookie does not verify', async () => {
  const value = await makeAuthCookieValue(PASSWORD);
  const tampered = value.slice(0, -2) + (value.endsWith('00') ? '11' : '00');
  assert.equal(await verifyAuthCookie(req('https://x/', { cookie: tampered }), PASSWORD), false);
});

test('garbage cookies do not verify', async () => {
  for (const junk of ['', 'abc', '123', '.', 'notanumber.deadbeef', '999.']) {
    assert.equal(await verifyAuthCookie(req('https://x/', { cookie: junk }), PASSWORD), false, junk);
  }
});

// ── middleware gate behavior ──

test('without APP_PASSWORD the site is open (pre-setup mode)', async () => {
  const res = await middleware(ctx(req('https://x/')));
  assert.equal(await res.text(), 'next-was-called');
});

test('without a cookie the login page is served, not the app', async () => {
  const res = await middleware(ctx(req('https://x/'), { APP_PASSWORD: PASSWORD }));
  assert.equal(res.status, 401);
  const html = await res.text();
  assert.match(html, /password/i);
  assert.doesNotMatch(html, /next-was-called/);
});

test('with a valid cookie the request passes through', async () => {
  const value = await makeAuthCookieValue(PASSWORD);
  const res = await middleware(ctx(req('https://x/', { cookie: value }), { APP_PASSWORD: PASSWORD }));
  assert.equal(await res.text(), 'next-was-called');
});

test('/api/* and /auth/login bypass the middleware (enforced downstream)', async () => {
  for (const path of ['https://x/api/data/topics', 'https://x/auth/login']) {
    const res = await middleware(ctx(req(path), { APP_PASSWORD: PASSWORD }));
    assert.equal(await res.text(), 'next-was-called', path);
  }
});

// ── login handler ──

test('correct password sets a verifying cookie and redirects home', async () => {
  const body = new URLSearchParams({ password: PASSWORD });
  const res = await login(ctx(
    req('https://x/auth/login', { method: 'POST', body, contentType: 'application/x-www-form-urlencoded' }),
    { APP_PASSWORD: PASSWORD }
  ));
  assert.equal(res.status, 302);
  assert.equal(new URL(res.headers.get('Location')).pathname, '/');
  const setCookie = res.headers.get('Set-Cookie');
  assert.match(setCookie, /^mb_auth=/);
  assert.match(setCookie, /HttpOnly/);
  assert.match(setCookie, /Secure/);
  const value = setCookie.match(/^mb_auth=([^;]+)/)[1];
  assert.equal(await verifyAuthCookie(req('https://x/', { cookie: value }), PASSWORD), true);
});

test('wrong password redirects back with ?bad=1 and no cookie', async () => {
  const body = new URLSearchParams({ password: 'nope' });
  const res = await login(ctx(
    req('https://x/auth/login', { method: 'POST', body, contentType: 'application/x-www-form-urlencoded' }),
    { APP_PASSWORD: PASSWORD }
  ));
  assert.equal(res.status, 302);
  assert.match(res.headers.get('Location'), /bad=1/);
  assert.equal(res.headers.get('Set-Cookie'), null);
});

// ── isAuthorized (the API-side check) ──

test('bearer token authorizes; wrong or missing bearer falls back to cookie rules', async () => {
  const env = { APP_PASSWORD: PASSWORD, API_TOKEN: 'agent-token' };
  assert.equal(await isAuthorized(req('https://x/', { bearer: 'agent-token' }), env), true);
  assert.equal(await isAuthorized(req('https://x/', { bearer: 'wrong' }), env), false);
  assert.equal(await isAuthorized(req('https://x/'), env), false);
  const cookie = await makeAuthCookieValue(PASSWORD);
  assert.equal(await isAuthorized(req('https://x/', { cookie }), env), true);
});
