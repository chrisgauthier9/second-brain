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
})();
