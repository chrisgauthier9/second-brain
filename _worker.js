// Cloudflare Worker for Second Brain
// Handles OAuth with Google Calendar + serves an aggregated hours API
// All other paths fall through to static assets

const CALENDAR_MAP = {
  finnian: ['b68d12fc2521bc71668d3782dc32eb904aefda84499b4c56c3eafa3a7b4e1158@group.calendar.google.com'],
  hoot: [
    'dfd334bf7fe0a806a35bf71aeafd97f0ce65429f6c868dbc87a501050ed6802d@group.calendar.google.com',
    'chris@hootreading.com'
  ],
  tempo: ['a20f1c0afc8934ad99e8b41ed9bcef0e942a61605c9baba49ff9cea4c2262c09@group.calendar.google.com'],
  fitness: ['6e6909428485030fffb72a179e58d5be3eeca85cac73015b7203dd1ee45913f2@group.calendar.google.com'],
  personal_dev: ['a70b9b8345b86476574c52f079c3706b8c0b65b0f1c1a763a69e1022b6c0e944@group.calendar.google.com'],
  chores: ['1024f8fa51b13aac876324bcc6c5d7675d80b399afd1632e1c08c7eb00a62a07@group.calendar.google.com'],
  leisure: ['fac47dfb6829f76764dd1a5c50ec3871f96139db12d101462d0a5453b5a9cc34@group.calendar.google.com'],
  laleh: ['d912415dbc00cc49714d4790daf129c3b06f2142d7dab624f538b19682e042c5@group.calendar.google.com']
};

const SCOPES = 'https://www.googleapis.com/auth/calendar.readonly';

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    try {
      if (url.pathname === '/auth/google') return handleAuthStart(url, env);
      if (url.pathname === '/auth/callback') return handleAuthCallback(url, env);
      if (url.pathname === '/api/calendar/hours') return handleHoursAPI(url, env, ctx);
      if (url.pathname === '/api/calendar/status') return handleStatus(env);
    } catch (err) {
      return new Response(JSON.stringify({ error: err.message, stack: err.stack }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // Fall through to static assets for everything else
    return env.ASSETS.fetch(request);
  }
};

// ===== OAuth: Start flow =====
async function handleAuthStart(url, env) {
  const redirectUri = `${url.origin}/auth/callback`;
  const authUrl = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  authUrl.searchParams.set('client_id', env.GOOGLE_CLIENT_ID);
  authUrl.searchParams.set('redirect_uri', redirectUri);
  authUrl.searchParams.set('response_type', 'code');
  authUrl.searchParams.set('scope', SCOPES);
  authUrl.searchParams.set('access_type', 'offline');
  authUrl.searchParams.set('prompt', 'consent'); // force refresh_token return
  return Response.redirect(authUrl.toString(), 302);
}

// ===== OAuth: Callback - exchange code for refresh token =====
async function handleAuthCallback(url, env) {
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

  // Store refresh token in KV
  await env.SECOND_BRAIN_KV.put('google_refresh_token', tokens.refresh_token);

  return new Response(
    `<html><body style="background:#0a0a0a;color:#fff;font-family:system-ui;padding:40px;max-width:600px;margin:0 auto">
      <h1>✓ Connected</h1>
      <p>Google Calendar is now linked. Refresh token stored.</p>
      <p><a href="/" style="color:#7c3aed">→ Back to dashboard</a></p>
    </body></html>`,
    { headers: { 'Content-Type': 'text/html' } }
  );
}

// ===== Get a fresh access token using stored refresh token =====
async function getAccessToken(env) {
  const refreshToken = await env.SECOND_BRAIN_KV.get('google_refresh_token');
  if (!refreshToken) throw new Error('No refresh token. Visit /auth/google first.');

  // Try cached access token
  const cached = await env.SECOND_BRAIN_KV.get('google_access_token_data', 'json');
  if (cached && cached.expires_at > Date.now()) {
    return cached.access_token;
  }

  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      refresh_token: refreshToken,
      client_id: env.GOOGLE_CLIENT_ID,
      client_secret: env.GOOGLE_CLIENT_SECRET,
      grant_type: 'refresh_token'
    })
  });

  const data = await res.json();
  if (!data.access_token) {
    throw new Error('Failed to refresh access token: ' + JSON.stringify(data));
  }

  // Cache (expires in ~1h, refresh 5min early)
  await env.SECOND_BRAIN_KV.put(
    'google_access_token_data',
    JSON.stringify({
      access_token: data.access_token,
      expires_at: Date.now() + (data.expires_in - 300) * 1000
    }),
    { expirationTtl: data.expires_in - 60 }
  );

  return data.access_token;
}

// ===== Calendar hours API =====
async function handleHoursAPI(url, env, ctx) {
  // Range: 'today', 'week', or custom 'start'/'end' (ISO date strings)
  const range = url.searchParams.get('range') || 'week';
  const customStart = url.searchParams.get('start');
  const customEnd = url.searchParams.get('end');

  let startISO, endISO;
  const now = new Date();

  if (customStart && customEnd) {
    startISO = customStart;
    endISO = customEnd;
  } else if (range === 'today') {
    const start = new Date(now);
    start.setHours(0, 0, 0, 0);
    const end = new Date(start);
    end.setDate(end.getDate() + 1);
    startISO = start.toISOString();
    endISO = end.toISOString();
  } else if (range === 'week') {
    // Sunday → Saturday week containing today
    const start = new Date(now);
    start.setHours(0, 0, 0, 0);
    start.setDate(start.getDate() - start.getDay()); // back to Sunday
    const end = new Date(start);
    end.setDate(end.getDate() + 7);
    startISO = start.toISOString();
    endISO = end.toISOString();
  } else {
    return new Response(JSON.stringify({ error: 'Invalid range' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  // Cache key
  const cacheKey = `hours:${startISO}:${endISO}`;
  const cached = await env.SECOND_BRAIN_KV.get(cacheKey, 'json');
  if (cached) {
    return new Response(JSON.stringify(cached), {
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        'X-Cache': 'HIT'
      }
    });
  }

  const token = await getAccessToken(env);

  // Fetch each calendar in parallel
  const allFetches = [];
  for (const [category, calendarIds] of Object.entries(CALENDAR_MAP)) {
    for (const calId of calendarIds) {
      allFetches.push(fetchCalendarEvents(calId, startISO, endISO, token).then(events => ({ category, events })));
    }
  }
  const results = await Promise.all(allFetches);

  // Aggregate by category
  const categories = {};
  for (const cat of Object.keys(CALENDAR_MAP)) {
    categories[cat] = { hours: 0, events: [] };
  }

  for (const { category, events } of results) {
    for (const ev of events) {
      const duration = eventDurationHours(ev);
      if (duration === 0) continue;
      categories[category].hours += duration;
      categories[category].events.push({
        title: ev.summary || '(no title)',
        start: ev.start.dateTime || ev.start.date,
        end: ev.end.dateTime || ev.end.date,
        duration
      });
    }
    // Round to 0.25
    categories[category].hours = Math.round(categories[category].hours * 4) / 4;
  }

  const payload = { range: { start: startISO, end: endISO }, categories };

  // Cache 5 minutes
  ctx.waitUntil(env.SECOND_BRAIN_KV.put(cacheKey, JSON.stringify(payload), { expirationTtl: 300 }));

  return new Response(JSON.stringify(payload), {
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'X-Cache': 'MISS'
    }
  });
}

async function fetchCalendarEvents(calendarId, startISO, endISO, token) {
  const url = new URL(`https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events`);
  url.searchParams.set('timeMin', startISO);
  url.searchParams.set('timeMax', endISO);
  url.searchParams.set('singleEvents', 'true');
  url.searchParams.set('maxResults', '250');

  const res = await fetch(url.toString(), {
    headers: { Authorization: `Bearer ${token}` }
  });
  if (!res.ok) {
    const txt = await res.text();
    console.error(`Calendar fetch failed for ${calendarId}: ${res.status} ${txt}`);
    return [];
  }
  const data = await res.json();
  return data.items || [];
}

function eventDurationHours(ev) {
  // Skip all-day events (start.date instead of start.dateTime)
  if (!ev.start.dateTime || !ev.end.dateTime) return 0;
  const start = new Date(ev.start.dateTime);
  const end = new Date(ev.end.dateTime);
  return (end - start) / 1000 / 60 / 60;
}

// ===== Status check =====
async function handleStatus(env) {
  const refreshToken = await env.SECOND_BRAIN_KV.get('google_refresh_token');
  return new Response(JSON.stringify({
    connected: !!refreshToken,
    kv_bound: !!env.SECOND_BRAIN_KV,
    client_id_set: !!env.GOOGLE_CLIENT_ID
  }), {
    headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
  });
}

