/**
 * localStorage data layer.
 * The Pages demo and `npm run dev` keep using this. Screens call /api; this
 * runs the same router as the Node server and saves the store on this phone.
 */
import { dispatch } from '../../server/apiDispatch.js';
import { withAuth } from './withAuth.js';

export const TOKEN_KEY = 'taskspeck-demo-token';

export function createLocalData({ storage } = {}) {
  const bag = storage || globalThis.localStorage;
  return withAuth({
    mode: 'local',
    async request({ method = 'GET', path, query, body, token } = {}) {
      if (path === '/api/auth/magic' || path === '/api/auth/phone' || path === '/api/auth/phone/verify') {
        return {
          status: 400,
          json: { error: 'Email link and phone codes need the shared database. This demo uses the sample people instead.' },
        };
      }
      const useToken = token != null ? token : (bag && bag.getItem ? (bag.getItem(TOKEN_KEY) || '') : '');
      const result = await dispatch({
        method: String(method || 'GET').toUpperCase(),
        path,
        query: query || new URLSearchParams(),
        body: body || {},
        token: useToken,
      });
      if (bag && bag.setItem) {
        if (result.tokenSet) bag.setItem(TOKEN_KEY, result.tokenSet);
        if (result.tokenClear) bag.removeItem(TOKEN_KEY);
      }
      return result;
    },
  });
}
