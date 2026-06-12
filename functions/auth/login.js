// POST /auth/login — checks the submitted password and sets the session cookie.

import { makeAuthCookieValue, authCookieHeader } from '../_lib.js';

export async function onRequestPost(context) {
  const { request, env } = context;

  if (!env.APP_PASSWORD) {
    return Response.redirect(new URL('/', request.url).toString(), 302);
  }

  let submitted = '';
  try {
    const form = await request.formData();
    submitted = String(form.get('password') || '');
  } catch {
    submitted = '';
  }

  if (submitted !== env.APP_PASSWORD) {
    return Response.redirect(new URL('/?bad=1', request.url).toString(), 302);
  }

  const cookieValue = await makeAuthCookieValue(env.APP_PASSWORD);
  return new Response(null, {
    status: 302,
    headers: {
      Location: new URL('/', request.url).toString(),
      'Set-Cookie': authCookieHeader(cookieValue),
    },
  });
}
