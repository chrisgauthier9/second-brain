import { CALENDAR_MAP, getAccessToken, fetchCalendarEvents, eventDurationHours, jsonResponse } from '../../_lib.js';

export async function onRequest(context) {
  const { request, env, waitUntil } = context;
  const url = new URL(request.url);

  try {
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
      const start = new Date(now);
      start.setHours(0, 0, 0, 0);
      start.setDate(start.getDate() - start.getDay());
      const end = new Date(start);
      end.setDate(end.getDate() + 7);
      startISO = start.toISOString();
      endISO = end.toISOString();
    } else {
      return jsonResponse({ error: 'Invalid range' }, 400);
    }

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

    const allFetches = [];
    for (const [category, calendarIds] of Object.entries(CALENDAR_MAP)) {
      for (const calId of calendarIds) {
        allFetches.push(
          fetchCalendarEvents(calId, startISO, endISO, token).then(events => ({ category, events }))
        );
      }
    }
    const results = await Promise.all(allFetches);

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
      categories[category].hours = Math.round(categories[category].hours * 4) / 4;
    }

    const payload = { range: { start: startISO, end: endISO }, categories };

    if (waitUntil) {
      waitUntil(env.SECOND_BRAIN_KV.put(cacheKey, JSON.stringify(payload), { expirationTtl: 300 }));
    }

    return new Response(JSON.stringify(payload), {
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        'X-Cache': 'MISS'
      }
    });
  } catch (err) {
    return jsonResponse({ error: err.message }, 500);
  }
}
