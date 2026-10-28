import { oauthUnavailable, listAuthProviders } from './auth.js';
import {
  userFromToken,
  signup,
  login,
  logout,
  updateProfile,
  deleteAccount,
  workspace,
  listPublishedTasks,
  getTaskListing,
  getTaskById,
  listUsers,
  getStoreSnapshot,
  upsertListingText,
  publishListing,
  placeBid,
  updateBid,
  withdrawBid,
  acceptBid,
  cancelTask,
  reportNoShow,
  rematchTask,
  requestFix,
  markFixed,
  openDispute,
  applyRefund,
  addReview,
  markStarted,
  markCompleted,
  approvePayment,
  postMessage,
  listMessages,
  saveBundle,
  saveSearch,
  updateSearch,
  deleteSearch,
  saveRecords,
  createShare,
  getPublicShare,
  csvForUser,
  csvForShare,
  listNotifications,
  markNotificationsRead,
  sweepJobDays,
} from './db.js';

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

function fail(res, result) {
  return sendJson(res, result.code || 400, { error: result.error || 'Request failed' });
}

async function handle(req, res) {
  const url = req.url?.split('?')[0] ?? '';
  const query = new URL(req.url || '', 'http://taskspeck.local').searchParams;
  const user = userFromToken(readToken(req));

  if (url === '/api/health' && req.method === 'GET') {
    return sendJson(res, 200, { ok: true });
  }

  if (url === '/api/auth/providers' && req.method === 'GET') {
    return sendJson(res, 200, { providers: listAuthProviders() });
  }

  const oauth = url.match(/^\/api\/auth\/oauth\/([a-z]+)$/);
  if (oauth && req.method === 'POST') {
    const result = oauthUnavailable(oauth[1]);
    return sendJson(res, result.code || 501, result);
  }

  if (url === '/api/auth/signup' && req.method === 'POST') {
    const body = await readJsonBody(req);
    const result = signup(body);
    if (result.error) return fail(res, result);
    setSessionCookie(res, result.token);
    return sendJson(res, 200, { user: result.user });
  }

  if (url === '/api/auth/login' && req.method === 'POST') {
    const body = await readJsonBody(req);
    const result = login(body);
    if (result.error) return fail(res, result);
    setSessionCookie(res, result.token);
    return sendJson(res, 200, { user: result.user });
  }

  if (url === '/api/auth/logout' && req.method === 'POST') {
    logout(readToken(req));
    clearSessionCookie(res);
    return sendJson(res, 200, { ok: true });
  }

  const shareCsv = url.match(/^\/api\/shares\/([a-f0-9]+)\.csv$/);
  if (shareCsv && req.method === 'GET') {
    const result = csvForShare(shareCsv[1]);
    if (result.error) return fail(res, result);
    return sendCsv(res, 'taskspeck-shared-jobs.csv', result.csv);
  }

  const shareGet = url.match(/^\/api\/shares\/([a-f0-9]+)$/);
  if (shareGet && req.method === 'GET') {
    const result = getPublicShare(shareGet[1]);
    if (result.error) return fail(res, result);
    return sendJson(res, 200, result);
  }

  if (url === '/api/auth/me' && req.method === 'GET') {
    if (!user) return sendJson(res, 200, { user: null });
    await sweepJobDays();
    return sendJson(res, 200, workspace(user));
  }

  if (!user) return sendJson(res, 401, { error: 'Sign in required' });

  if (url === '/api/auth/profile' && req.method === 'PATCH') {
    const body = await readJsonBody(req);
    const result = updateProfile(user, body);
    if (result.error) return fail(res, result);
    return sendJson(res, 200, result);
  }

  if (url === '/api/auth/account' && req.method === 'DELETE') {
    const result = deleteAccount(user);
    if (result.error) return fail(res, result);
    clearSessionCookie(res);
    return sendJson(res, 200, result);
  }

  if (url === '/api/me/settings' && req.method === 'PATCH') {
    const body = await readJsonBody(req);
    const result = updateProfile(user, body);
    if (result.error) return fail(res, result);
    return sendJson(res, 200, result);
  }

  if (url === '/api/me/notifications' && req.method === 'GET') {
    return sendJson(res, 200, { notifications: listNotifications(user) });
  }
  if (url === '/api/me/notifications/read' && req.method === 'POST') {
    return sendJson(res, 200, markNotificationsRead(user));
  }

  if (url === '/api/me/records.csv' && req.method === 'GET') {
    return sendCsv(res, 'taskspeck-jobs.csv', csvForUser(user));
  }
  if (url === '/api/me/records' && req.method === 'POST') {
    const body = await readJsonBody(req);
    const result = saveRecords(user, body.records || body);
    if (result.error) return fail(res, result);
    return sendJson(res, 200, result);
  }
  if (url === '/api/me/shares' && req.method === 'POST') {
    const body = await readJsonBody(req);
    const result = createShare(user, body);
    if (result.error) return fail(res, result);
    return sendJson(res, 200, result);
  }

  if (url === '/api/me/searches' && req.method === 'GET') {
    return sendJson(res, 200, { savedSearches: workspace(user).savedSearches });
  }
  if (url === '/api/me/searches' && req.method === 'POST') {
    const body = await readJsonBody(req);
    const result = saveSearch(user, body);
    if (result.error) return fail(res, result);
    return sendJson(res, 200, result);
  }
  const searchPatch = url.match(/^\/api\/me\/searches\/(\d+)$/);
  if (searchPatch && req.method === 'PATCH') {
    const body = await readJsonBody(req);
    const result = updateSearch(searchPatch[1], user, body);
    if (result.error) return fail(res, result);
    return sendJson(res, 200, result);
  }
  if (searchPatch && req.method === 'DELETE') {
    const result = deleteSearch(searchPatch[1], user);
    if (result.error) return fail(res, result);
    return sendJson(res, 200, result);
  }

  if (url === '/api/users' && req.method === 'GET') {
    return sendJson(res, 200, { users: listUsers() });
  }
  if (url === '/api/store' && req.method === 'GET') {
    return sendJson(res, 200, getStoreSnapshot(user));
  }
  if (url === '/api/tasks' && req.method === 'GET') {
    return sendJson(res, 200, { tasks: listPublishedTasks(user) });
  }
  if (url === '/api/tasks/all' && req.method === 'GET') {
    return sendJson(res, 200, { tasks: getTaskListing(user) });
  }
  if (url === '/api/tasks/draft' && req.method === 'PUT') {
    const body = await readJsonBody(req);
    const id = body.id != null ? Number(body.id) : null;
    const result = upsertListingText(body.text ?? '', Number.isFinite(id) ? id : null, user);
    if (result.error) return fail(res, result);
    return sendJson(res, 200, result);
  }

  const bidEdit = url.match(/^\/api\/bids\/(\d+)$/);
  if (bidEdit && req.method === 'PATCH') {
    const body = await readJsonBody(req);
    const result = updateBid(bidEdit[1], body, user);
    if (result.error) return fail(res, result);
    return sendJson(res, 200, result);
  }
  const bidWithdraw = url.match(/^\/api\/bids\/(\d+)\/withdraw$/);
  if (bidWithdraw && req.method === 'POST') {
    const result = await withdrawBid(bidWithdraw[1], user);
    if (result.error) return fail(res, result);
    return sendJson(res, 200, result);
  }

  const taskGet = url.match(/^\/api\/tasks\/(\d+)$/);
  if (taskGet && req.method === 'GET') {
    const row = getTaskById(Number(taskGet[1]), user);
    if (!row) return sendJson(res, 404, { error: 'Task not found' });
    return sendJson(res, 200, { task: row });
  }

  const taskAction = url.match(/^\/api\/tasks\/(\d+)\/([a-z-]+)$/);
  if (taskAction) {
    const id = Number(taskAction[1]);
    const action = taskAction[2];
    const body = req.method === 'GET' ? {} : await readJsonBody(req);
    if (action === 'publish' && req.method === 'POST') {
      const result = await publishListing(id, body, user);
      if (result.error) return fail(res, result);
      return sendJson(res, 200, result);
    }
    if (action === 'bids' && req.method === 'POST') {
      const result = await placeBid(id, body, user);
      if (result.error) return fail(res, result);
      return sendJson(res, 200, result);
    }
    if (action === 'accept-bid' && req.method === 'POST') {
      const result = await acceptBid(id, body, user);
      if (result.error) return fail(res, result);
      return sendJson(res, 200, result);
    }
    if (action === 'start' && req.method === 'POST') {
      const result = markStarted(id, user);
      if (result.error) return fail(res, result);
      return sendJson(res, 200, result);
    }
    if (action === 'complete' && req.method === 'POST') {
      const result = markCompleted(id, user, body);
      if (result.error) return fail(res, result);
      return sendJson(res, 200, result);
    }
    if (action === 'approve-payment' && req.method === 'POST') {
      const result = await approvePayment(id, user);
      if (result.error) return fail(res, result);
      return sendJson(res, 200, result);
    }
    if (action === 'cancel' && req.method === 'POST') {
      const result = await cancelTask(id, user, body);
      if (result.error) return fail(res, result);
      return sendJson(res, 200, result);
    }
    if (action === 'no-show' && req.method === 'POST') {
      const result = await reportNoShow(id, user);
      if (result.error) return fail(res, result);
      return sendJson(res, 200, result);
    }
    if (action === 'rematch' && req.method === 'POST') {
      const result = rematchTask(id, user);
      if (result.error) return fail(res, result);
      return sendJson(res, 200, result);
    }
    if (action === 'fix' && req.method === 'POST') {
      const result = await requestFix(id, user, body);
      if (result.error) return fail(res, result);
      return sendJson(res, 200, result);
    }
    if (action === 'fix-done' && req.method === 'POST') {
      const result = markFixed(id, user, body);
      if (result.error) return fail(res, result);
      return sendJson(res, 200, result);
    }
    if (action === 'dispute' && req.method === 'POST') {
      const result = await openDispute(id, user, body);
      if (result.error) return fail(res, result);
      return sendJson(res, 200, result);
    }
    if (action === 'refund' && req.method === 'POST') {
      const result = await applyRefund(id, user, body);
      if (result.error) return fail(res, result);
      return sendJson(res, 200, result);
    }
    if (action === 'review' && req.method === 'POST') {
      const result = await addReview(id, user, body);
      if (result.error) return fail(res, result);
      return sendJson(res, 200, result);
    }
    if (action === 'messages' && req.method === 'GET') {
      const result = listMessages(id, user);
      if (result.error) return fail(res, result);
      return sendJson(res, 200, result);
    }
    if (action === 'messages' && req.method === 'POST') {
      const result = await postMessage(id, user, body);
      if (result.error) return fail(res, result);
      return sendJson(res, 200, result);
    }
    if (action === 'bundle' && req.method === 'PUT') {
      const result = saveBundle(id, user, body.bundle ?? body);
      if (result.error) return fail(res, result);
      return sendJson(res, 200, result);
    }
  }

  return sendJson(res, 404, { error: 'Not found', path: url, query: query.toString() });
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
