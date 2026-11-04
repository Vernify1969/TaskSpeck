import { oauthUnavailable, listAuthProviders } from './auth.js';
import { demoCredentials, demoPublic } from './demoAccounts.js';
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
  catalogue,
  lookupVictoria,
  joinWaitlist,
  waitlistCsv,
  releaseMilestone,
  zoneFor,
} from './db.js';

function ok(json, extra = {}) {
  return { status: 200, json, ...extra };
}

function fail(result) {
  return { status: result.code || 400, json: { error: result.error || 'Request failed' } };
}

function csv(filename, text) {
  return { status: 200, csv: text, filename, json: null };
}

/**
 * One router for the Node server and the phone demo.
 * tokenSet / tokenClear stand in for the session cookie.
 */
export async function dispatch({ method, path, query, body = {}, token = '', adminKey = '' }) {
  const url = path || '';
  const user = userFromToken(token);
  const q = query || new URLSearchParams();

  if (url === '/api/health' && method === 'GET') return ok({ ok: true });
  if (url === '/api/demo' && method === 'GET') return ok(demoPublic());

  if (url === '/api/demo/view' && method === 'POST') {
    const creds = demoCredentials(body.email);
    if (creds.error) return fail(creds);
    logout(token);
    const result = login(creds);
    if (result.error) return fail(result);
    return ok({ user: result.user }, { tokenSet: result.token });
  }

  if (url === '/api/places' && method === 'GET') return ok(catalogue(q.get('q') || ''));
  if (url === '/api/launch' && method === 'GET') return ok(zoneFor(q.get('suburb') || ''));

  if (url === '/api/waitlist' && method === 'POST') {
    const result = joinWaitlist(body);
    if (result.error) return fail(result);
    return ok(result);
  }

  if (url === '/api/auth/providers' && method === 'GET') return ok({ providers: listAuthProviders() });

  const oauth = url.match(/^\/api\/auth\/oauth\/([a-z]+)$/);
  if (oauth && method === 'POST') {
    const result = oauthUnavailable(oauth[1]);
    return { status: result.code || 501, json: result };
  }

  if (url === '/api/auth/signup' && method === 'POST') {
    const result = signup(body);
    if (result.error) return fail(result);
    return ok({ user: result.user }, { tokenSet: result.token });
  }

  if (url === '/api/auth/login' && method === 'POST') {
    const result = login(body);
    if (result.error) return fail(result);
    return ok({ user: result.user }, { tokenSet: result.token });
  }

  if (url === '/api/auth/logout' && method === 'POST') {
    logout(token);
    return ok({ ok: true }, { tokenClear: true });
  }

  const shareCsv = url.match(/^\/api\/shares\/([a-f0-9]+)\.csv$/);
  if (shareCsv && method === 'GET') {
    const result = csvForShare(shareCsv[1]);
    if (result.error) return fail(result);
    return csv('taskspeck-shared-jobs.csv', result.csv);
  }

  const shareGet = url.match(/^\/api\/shares\/([a-f0-9]+)$/);
  if (shareGet && method === 'GET') {
    const result = getPublicShare(shareGet[1]);
    if (result.error) return fail(result);
    return ok(result);
  }

  if (url === '/api/auth/me' && method === 'GET') {
    if (!user) return ok({ user: null });
    await sweepJobDays();
    return ok(workspace(user));
  }

  if (url === '/api/waitlist.csv' && method === 'GET') {
    const key = process.env.LAUNCH_ADMIN_KEY || '';
    if (key) {
      if (adminKey !== key) return { status: 403, json: { error: 'Not allowed' } };
    } else if (!user) {
      return { status: 401, json: { error: 'Sign in required' } };
    }
    return csv('taskspeck-waitlist.csv', waitlistCsv());
  }

  if (url === '/api/places/geocode' && method === 'GET') {
    if (!user) return { status: 401, json: { error: 'Sign in required' } };
    const result = await lookupVictoria(q.get('q') || '');
    if (result.error) return fail(result);
    return ok(result);
  }

  if (!user) return { status: 401, json: { error: 'Sign in required' } };

  if (url === '/api/auth/profile' && method === 'PATCH') {
    const result = updateProfile(user, body);
    if (result.error) return fail(result);
    return ok(result);
  }

  if (url === '/api/auth/account' && method === 'DELETE') {
    const result = deleteAccount(user);
    if (result.error) return fail(result);
    return ok(result, { tokenClear: true });
  }

  if (url === '/api/me/settings' && method === 'PATCH') {
    const result = updateProfile(user, body);
    if (result.error) return fail(result);
    return ok(result);
  }

  if (url === '/api/me/notifications' && method === 'GET') return ok({ notifications: listNotifications(user) });
  if (url === '/api/me/notifications/read' && method === 'POST') return ok(markNotificationsRead(user));
  if (url === '/api/me/records.csv' && method === 'GET') return csv('taskspeck-jobs.csv', csvForUser(user));

  if (url === '/api/me/records' && method === 'POST') {
    const result = saveRecords(user, body.records || body);
    if (result.error) return fail(result);
    return ok(result);
  }

  if (url === '/api/me/shares' && method === 'POST') {
    const result = createShare(user, body);
    if (result.error) return fail(result);
    return ok(result);
  }

  if (url === '/api/me/searches' && method === 'GET') return ok({ savedSearches: workspace(user).savedSearches });

  if (url === '/api/me/searches' && method === 'POST') {
    const result = saveSearch(user, body);
    if (result.error) return fail(result);
    return ok(result);
  }

  const searchPatch = url.match(/^\/api\/me\/searches\/(\d+)$/);
  if (searchPatch && method === 'PATCH') {
    const result = updateSearch(searchPatch[1], user, body);
    if (result.error) return fail(result);
    return ok(result);
  }
  if (searchPatch && method === 'DELETE') {
    const result = deleteSearch(searchPatch[1], user);
    if (result.error) return fail(result);
    return ok(result);
  }

  if (url === '/api/users' && method === 'GET') return ok({ users: listUsers() });
  if (url === '/api/store' && method === 'GET') return ok(getStoreSnapshot(user));
  if (url === '/api/tasks' && method === 'GET') return ok({ tasks: listPublishedTasks(user) });
  if (url === '/api/tasks/all' && method === 'GET') return ok({ tasks: getTaskListing(user) });

  if (url === '/api/tasks/draft' && method === 'PUT') {
    const id = body.id != null ? Number(body.id) : null;
    const result = upsertListingText(body.text ?? '', Number.isFinite(id) ? id : null, user);
    if (result.error) return fail(result);
    return ok(result);
  }

  const bidEdit = url.match(/^\/api\/bids\/(\d+)$/);
  if (bidEdit && method === 'PATCH') {
    const result = updateBid(bidEdit[1], body, user);
    if (result.error) return fail(result);
    return ok(result);
  }

  const bidWithdraw = url.match(/^\/api\/bids\/(\d+)\/withdraw$/);
  if (bidWithdraw && method === 'POST') {
    const result = await withdrawBid(bidWithdraw[1], user);
    if (result.error) return fail(result);
    return ok(result);
  }

  const taskGet = url.match(/^\/api\/tasks\/(\d+)$/);
  if (taskGet && method === 'GET') {
    const row = getTaskById(Number(taskGet[1]), user);
    if (!row) return { status: 404, json: { error: 'Task not found' } };
    return ok({ task: row });
  }

  const milestoneRelease = url.match(/^\/api\/tasks\/(\d+)\/milestones\/(\d+)\/release$/);
  if (milestoneRelease && method === 'POST') {
    const result = await releaseMilestone(milestoneRelease[1], milestoneRelease[2], user);
    if (result.error) return fail(result);
    return ok(result);
  }

  const taskAction = url.match(/^\/api\/tasks\/(\d+)\/([a-z-]+)$/);
  if (taskAction) {
    const id = Number(taskAction[1]);
    const action = taskAction[2];
    const run = async (result) => (result && result.error ? fail(result) : ok(result));
    if (action === 'publish' && method === 'POST') return run(await publishListing(id, body, user));
    if (action === 'bids' && method === 'POST') return run(await placeBid(id, body, user));
    if (action === 'accept-bid' && method === 'POST') return run(await acceptBid(id, body, user));
    if (action === 'start' && method === 'POST') return run(markStarted(id, user));
    if (action === 'complete' && method === 'POST') return run(markCompleted(id, user, body));
    if (action === 'approve-payment' && method === 'POST') return run(await approvePayment(id, user));
    if (action === 'cancel' && method === 'POST') return run(await cancelTask(id, user, body));
    if (action === 'no-show' && method === 'POST') return run(await reportNoShow(id, user));
    if (action === 'rematch' && method === 'POST') return run(rematchTask(id, user));
    if (action === 'fix' && method === 'POST') return run(await requestFix(id, user, body));
    if (action === 'fix-done' && method === 'POST') return run(markFixed(id, user, body));
    if (action === 'dispute' && method === 'POST') return run(await openDispute(id, user, body));
    if (action === 'refund' && method === 'POST') return run(await applyRefund(id, user, body));
    if (action === 'review' && method === 'POST') return run(await addReview(id, user, body));
    if (action === 'messages' && method === 'GET') return run(listMessages(id, user));
    if (action === 'messages' && method === 'POST') return run(await postMessage(id, user, body));
    if (action === 'bundle' && method === 'PUT') return run(saveBundle(id, user, body.bundle ?? body));
  }

  return { status: 404, json: { error: 'Not found', path: url, query: q.toString() } };
}
