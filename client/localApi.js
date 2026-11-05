import './process-global.js';
import { BROWSER_STORE_KEY } from '../server/persist.js';
import { seedDemo } from '../server/seedDemo.js';
import * as db from '../server/db.js';
import { dispatch } from '../server/apiDispatch.js';

const TOKEN_KEY = 'taskspeck-demo-token';

function requestUrl(input) {
  if (typeof input === 'string') return input;
  if (input instanceof URL) return input.href;
  return input && input.url ? input.url : '';
}

export function resetDemoData() {
  try {
    localStorage.removeItem(BROWSER_STORE_KEY);
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem('taskspeck-sos-reports');
  } catch { /* private mode keeps only this tab */ }
  location.reload();
}

export async function installLocalApi() {
  if (globalThis.__taskspeckLocalApi) return;
  globalThis.__taskspeckLocalApi = true;
  try {
    if (!localStorage.getItem(BROWSER_STORE_KEY)) await seedDemo(db);
  } catch (err) {
    console.error(err);
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
    const token = localStorage.getItem(TOKEN_KEY) || '';
    const result = await dispatch({ method, path: parsed.pathname, query: parsed.searchParams, body, token });
    if (result.tokenSet) localStorage.setItem(TOKEN_KEY, result.tokenSet);
    if (result.tokenClear) localStorage.removeItem(TOKEN_KEY);
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
