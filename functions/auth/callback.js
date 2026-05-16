export async function onRequest(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  const code = url.searchParams.get('code');
  if (!code) return new Response('Missing code', { status: 400 });

  const redirectUri = `${url.origin}/auth/callback`;

  const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: env.GOOGLE_CLIENT_ID,
      client_secret: env.GOOGLE_CLIENT_SECRET,
      redirect_uri: redirectUri,
      grant_type: 'authorization_code'
    })
  });

  const tokens = await tokenRes.json();
  if (!tokens.refresh_token) {
    return new Response(`OAuth failed. Response: ${JSON.stringify(tokens)}`, { status: 500 });
  }

  await env.SECOND_BRAIN_KV.put('google_refresh_token', tokens.refresh_token);

  return new Response(
    `<html><body style="background:#0a0a0a;color:#fff;font-family:system-ui;padding:40px;max-width:600px;margin:0 auto">
      <h1>✓ Connected</h1>
      <p>Google Calendar is now linked.</p>
      <p><a href="/" style="color:#7c3aed">→ Back to dashboard</a></p>
    </body></html>`,
    { headers: { 'Content-Type': 'text/html' } }
  );
}
