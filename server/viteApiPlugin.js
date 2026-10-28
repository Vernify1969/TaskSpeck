import {
  getStoreSnapshot,
  listUsers,
  getTaskListing,
  listPublishedTasks,
  getTaskById,
  upsertListingText,
  publishListing,
  placeBid,
  acceptBid,
  markStarted,
  markCompleted,
  approvePayment,
} from './db.js';

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', (chunk) => {
      raw += chunk;
      if (raw.length > 64_000) {
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

export function taskApiPlugin() {
  return {
    name: 'taskspeck-api',
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        const url = req.url?.split('?')[0] ?? '';
        if (!url.startsWith('/api/')) return next();

        try {
          if (url === '/api/users' && req.method === 'GET') {
            return sendJson(res, 200, { users: listUsers() });
          }

          if (url === '/api/store' && req.method === 'GET') {
            return sendJson(res, 200, getStoreSnapshot());
          }

          if (url === '/api/tasks' && req.method === 'GET') {
            return sendJson(res, 200, { tasks: listPublishedTasks() });
          }

          if (url === '/api/tasks/all' && req.method === 'GET') {
            return sendJson(res, 200, { tasks: getTaskListing() });
          }

          if (url === '/api/tasks/draft' && req.method === 'PUT') {
            const body = await readJsonBody(req);
            const id = body.id != null ? Number(body.id) : null;
            const row = upsertListingText(body.text ?? '', Number.isFinite(id) ? id : null);
            return sendJson(res, 200, { task: row });
          }

          const taskGet = url.match(/^\/api\/tasks\/(\d+)$/);
          if (taskGet && req.method === 'GET') {
            const row = getTaskById(Number(taskGet[1]));
            if (!row) return sendJson(res, 404, { error: 'Task not found' });
            return sendJson(res, 200, { task: row });
          }

          const publishMatch = url.match(/^\/api\/tasks\/(\d+)\/publish$/);
          if (publishMatch && req.method === 'POST') {
            const id = Number(publishMatch[1]);
            const body = await readJsonBody(req);
            const row = publishListing(id, body);
            if (!row) return sendJson(res, 404, { error: 'Task not found' });
            return sendJson(res, 200, { task: row });
          }

          const bidMatch = url.match(/^\/api\/tasks\/(\d+)\/bids$/);
          if (bidMatch && req.method === 'POST') {
            const id = Number(bidMatch[1]);
            const body = await readJsonBody(req);
            const result = placeBid(id, { taskerName: body.taskerName, fee: body.fee, taskerId: body.taskerId });
            if (result.error) return sendJson(res, result.code || 400, { error: result.error });
            return sendJson(res, 200, result);
          }

          const acceptMatch = url.match(/^\/api\/tasks\/(\d+)\/accept-bid$/);
          if (acceptMatch && req.method === 'POST') {
            const id = Number(acceptMatch[1]);
            const body = await readJsonBody(req);
            const result = acceptBid(id, body);
            if (result.error) return sendJson(res, result.code || 400, { error: result.error });
            return sendJson(res, 200, result);
          }

          const startMatch = url.match(/^\/api\/tasks\/(\d+)\/start$/);
          if (startMatch && req.method === 'POST') {
            const result = markStarted(Number(startMatch[1]));
            if (result.error) return sendJson(res, result.code || 400, { error: result.error });
            return sendJson(res, 200, result);
          }

          const completeMatch = url.match(/^\/api\/tasks\/(\d+)\/complete$/);
          if (completeMatch && req.method === 'POST') {
            const result = markCompleted(Number(completeMatch[1]));
            if (result.error) return sendJson(res, result.code || 400, { error: result.error });
            return sendJson(res, 200, result);
          }

          const payMatch = url.match(/^\/api\/tasks\/(\d+)\/approve-payment$/);
          if (payMatch && req.method === 'POST') {
            const result = approvePayment(Number(payMatch[1]));
            if (result.error) return sendJson(res, result.code || 400, { error: result.error });
            return sendJson(res, 200, result);
          }

          return sendJson(res, 404, { error: 'Not found' });
        } catch (err) {
          return sendJson(res, 400, { error: err.message || 'Bad request' });
        }
      });
    },
  };
}
