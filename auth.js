// Shared auth gate for all dashboard pages.
// Include after the supabase-js CDN script and before any page logic.
//
// Behavior:
// - On page load, check for an active Supabase session.
// - If there is none, redirect to /login.html.
// - If there is one, expose `window.sb` (the authenticated client) and call
//   `window._authReady()` if a page provided one. Pages can also just await
//   `window._authReadyPromise`.

(function () {
  const SUPABASE_URL = 'https://pkdbzoptboinysspnpjp.supabase.co';
  const SUPABASE_KEY = 'sb_publishable_3AzsiWvSIyBQ876U61ahbQ_vQtkdO6J';

  if (!window.supabase) {
    console.error('auth.js: supabase-js not loaded. Include the supabase CDN script first.');
    return;
  }

  const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
  });
  window.sb = sb;

  let resolveReady;
  window._authReadyPromise = new Promise((r) => { resolveReady = r; });

  // Ensure body content is hidden until the gate decides what to do.
  document.documentElement.style.visibility = 'hidden';

  sb.auth.getSession().then(({ data: { session } }) => {
    if (!session) {
      const here = (window.location.pathname.split('/').pop() || 'index.html').replace(/\.html$/, '');
      if (here !== 'login') {
        window.location.replace('login.html');
        return;
      }
    }
    document.documentElement.style.visibility = '';
    resolveReady(session);
  });

  // If the user signs out elsewhere, kick them back to the login page.
  sb.auth.onAuthStateChange((event) => {
    if (event === 'SIGNED_OUT') {
      const here = (window.location.pathname.split('/').pop() || 'index.html').replace(/\.html$/, '');
      if (here !== 'login') window.location.replace('login.html');
    }
  });

  // Helper: sign out from any page.
  window.signOut = async function () {
    await sb.auth.signOut();
    window.location.replace('login.html');
  };

  // ----- Google Calendar status banner -----
  // Fires after auth resolves with a real session. Pings /api/calendar/status
  // and injects a sticky warning banner if the refresh token is broken.
  // The banner links to /auth/google so the user can re-authorize in one click.
  window._authReadyPromise.then(async (session) => {
    if (!session) return; // signed out; auth.js will redirect

    // Forward ?force_disconnect=1 from the current URL so the banner can be tested
    // by loading e.g. alignment.html?force_disconnect=1
    const pageParams = new URLSearchParams(window.location.search);
    const statusUrl = pageParams.has('force_disconnect')
      ? '/api/calendar/status?force_disconnect=1'
      : '/api/calendar/status';

    let status;
    try {
      const res = await fetch(statusUrl);
      if (!res.ok) return;
      status = await res.json();
    } catch (e) {
      return; // status endpoint unreachable; don't false-alarm
    }

    const broken = !status.connected ||
      (status.token_refresh && status.token_refresh.ok === false);
    if (!broken) return;

    const reason = !status.connected
      ? 'Not connected'
      : (status.token_refresh && (status.token_refresh.error_description || status.token_refresh.error))
        || 'refresh failed';

    const inject = () => {
      if (document.getElementById('calendar-status-banner')) return;
      const banner = document.createElement('div');
      banner.id = 'calendar-status-banner';
      banner.innerHTML =
        '<span style="flex:1">⚠️ <strong>Google Calendar disconnected.</strong> Hours data unavailable. <span style="opacity:.75">(' + reason + ')</span></span>' +
        '<a href="/auth/google" style="padding:6px 14px;background:#fef3c7;color:#7c2d12;border-radius:6px;text-decoration:none;font-weight:600;font-size:13px;white-space:nowrap">Reconnect →</a>';
      banner.style.cssText =
        'position:sticky;top:0;left:0;right:0;z-index:9999;' +
        'display:flex;align-items:center;gap:12px;' +
        'padding:10px 16px;' +
        'background:#7c2d12;color:#fef3c7;' +
        'font-size:14px;font-family:system-ui,sans-serif;' +
        'border-bottom:1px solid #92400e';
      document.body.insertBefore(banner, document.body.firstChild);
    };

    if (document.body) inject();
    else document.addEventListener('DOMContentLoaded', inject);
  });
})();
