/**
 * Browser wiring for live mode. Loaded only when both Supabase env vars are set,
 * so the GitHub Pages demo never downloads or calls Supabase.
 */
import { createSupabaseData } from './supabaseData.js';

function requestUrl(input) {
  if (typeof input === 'string') return input;
  if (input instanceof URL) return input.href;
  return input && input.url ? input.url : '';
}

export async function installLiveData() {
  if (globalThis.__taskspeckLiveApi) return;
  globalThis.__taskspeckLiveApi = true;
  await import('../process-global.js');
  const url = import.meta.env.VITE_SUPABASE_URL;
  const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;
  let layer;
  try {
    const { createClient } = await import('@supabase/supabase-js');
    const supabase = createClient(url, anonKey, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
    });
    layer = createSupabaseData({ supabase });
  } catch (err) {
    console.error(err);
    layer = {
      mode: 'live',
      async request() {
        return { status: 503, json: { error: 'Sign-in is not ready yet. Check the Supabase URL and anon key.' } };
      },
    };
  }
  const orig = window.fetch.bind(window);
  window.fetch = async (input, init = {}) => {
    const raw = requestUrl(input);
    const parsed = new URL(raw, location.origin);
    if (parsed.origin !== location.origin || !parsed.pathname.startsWith('/api/')) return orig(input, init);
    const method = String(init.method || (input && input.method) || 'GET').toUpperCase();
    let body = {};
    if (init.body) {
      try { body = typeof init.body === 'string' ? JSON.parse(init.body) : init.body; } catch { body = {}; }
    }
    const result = await layer.request({ method, path: parsed.pathname, query: parsed.searchParams, body });
    if (result.csv != null) {
      return new Response(result.csv, {
        status: result.status || 200,
        headers: {
          'Content-Type': 'text/csv; charset=utf-8',
          'Content-Disposition': `attachment; filename="${result.filename || 'taskspeck.csv'}"`,
        },
      });
    }
    return new Response(JSON.stringify(result.json ?? {}), {
      status: result.status || 200,
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
    });
  };
}
