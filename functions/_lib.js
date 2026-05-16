// Shared helpers for Cloudflare Pages Functions

export const CALENDAR_MAP = {
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

export const SCOPES = 'https://www.googleapis.com/auth/calendar.readonly';

export async function getAccessToken(env) {
  const refreshToken = await env.SECOND_BRAIN_KV.get('google_refresh_token');
  if (!refreshToken) throw new Error('No refresh token. Visit /auth/google first.');

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

export async function fetchCalendarEvents(calendarId, startISO, endISO, token) {
  const url = new URL(`https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events`);
  url.searchParams.set('timeMin', startISO);
  url.searchParams.set('timeMax', endISO);
  url.searchParams.set('singleEvents', 'true');
  url.searchParams.set('maxResults', '250');

  const res = await fetch(url.toString(), {
    headers: { Authorization: `Bearer ${token}` }
  });
  if (!res.ok) {
    return [];
  }
  const data = await res.json();
  return data.items || [];
}

export function eventDurationHours(ev) {
  if (!ev.start.dateTime || !ev.end.dateTime) return 0;
  const start = new Date(ev.start.dateTime);
  const end = new Date(ev.end.dateTime);
  return (end - start) / 1000 / 60 / 60;
}

export const jsonResponse = (data, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*'
    }
  });
