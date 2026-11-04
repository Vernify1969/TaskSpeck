import { sweepJobDays } from './db.js';
import { dispatch } from './apiDispatch.js';

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', (chunk) => {
      raw += chunk;
      if (raw.length > 2_000_000) {
        reject(new Error('Body too large'));
        req.destroy();
      }
    });
    req.on('end', () => {
      if (!raw) return resolve({});
      try {
        resolve(JSON.parse(raw));
      } catch {
        reject(new Error('Invalid JSON'));
      }
    });
    req.on('error', reject);
  });
}

function sendJson(res, status, data) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(data));
}

function sendCsv(res, filename, csv) {
  res.statusCode = 200;
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.end(csv);
}

function readCookie(req, name) {
  const raw = req.headers.cookie || '';
  for (const part of raw.split(/;\s*/)) {
    const i = part.indexOf('=');
    if (i === -1) continue;
    if (part.slice(0, i) === name) return decodeURIComponent(part.slice(i + 1));
  }
  return '';
}

function readToken(req) {
  const header = req.headers.authorization || '';
  if (header.startsWith('Bearer ')) return header.slice(7).trim();
  return readCookie(req, 'ts_session');
}

function setSessionCookie(res, token) {
  res.setHeader('Set-Cookie', [
    `ts_session=${encodeURIComponent(token)}`,
    'HttpOnly',
    'SameSite=Lax',
    'Path=/',
    `Max-Age=${30 * 24 * 3600}`,
  ].join('; '));
}

function clearSessionCookie(res) {
  res.setHeader('Set-Cookie', 'ts_session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0');
}

async function handle(req, res) {
  const rawUrl = req.url || '';
  const path = rawUrl.split('?')[0];
  const query = new URL(rawUrl, 'http://taskspeck.local').searchParams;
  const method = req.method || 'GET';
  const body = method === 'GET' || method === 'HEAD' ? {} : await readJsonBody(req);
  const result = await dispatch({
    method,
    path,
    query,
    body,
    token: readToken(req),
    adminKey: req.headers['x-admin-key'] || '',
  });
  if (result.tokenSet) setSessionCookie(res, result.tokenSet);
  if (result.tokenClear) clearSessionCookie(res);
  if (result.csv != null) return sendCsv(res, result.filename || 'taskspeck.csv', result.csv);
  return sendJson(res, result.status || 200, result.json ?? {});
}

function attach(middlewares) {
  middlewares.use(async (req, res, next) => {
    const url = req.url?.split('?')[0] ?? '';
    if (!url.startsWith('/api/')) return next();
    try {
      await handle(req, res);
    } catch (err) {
      if (!res.headersSent) sendJson(res, 400, { error: err.message || 'Bad request' });
    }
  });
}

export function taskApiPlugin() {
  return {
    name: 'taskspeck-api',
    configureServer(server) {
      attach(server.middlewares);
      const timer = setInterval(() => { sweepJobDays().catch(() => {}); }, 60_000);
      server.httpServer?.on('close', () => clearInterval(timer));
    },
    configurePreviewServer(server) {
      attach(server.middlewares);
    },
  };
}
