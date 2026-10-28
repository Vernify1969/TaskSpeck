import fs from 'fs';
import path from 'path';

const DATA_DIR = path.join(process.cwd(), 'data');
const STORE_FILE = path.join(DATA_DIR, 'store.json');
const LEGACY_FILE = path.join(DATA_DIR, 'tasks.json');

/** @typedef {'Draft'|'Open'|'Assigned'|'Started'|'Completed'|'PaymentReleased'} TaskStatus */
/** @typedef {'pending'|'accepted'|'rejected'} BidStatus */

/**
 * @typedef {Object} User
 * @property {number} id
 * @property {'requester'|'tasker'} role
 * @property {string} name
 */

/**
 * @typedef {Object} Task
 * @property {number} id
 * @property {number} requesterId
 * @property {string} text
 * @property {TaskStatus} status
 * @property {boolean} published
 * @property {string} [title]
 * @property {string} [cat]
 * @property {number|null} [acceptedBidId]
 * @property {'none'|'AUTHORISED'|'RELEASED'} paymentStatus
 * @property {string} updatedAt
 */

/**
 * @typedef {Object} Bid
 * @property {number} id
 * @property {number} taskId
 * @property {number} taskerId
 * @property {string} taskerName
 * @property {number} fee
 * @property {BidStatus} status
 * @property {string} at
 */

/** @type {{ counters: { taskId: number, bidId: number, userId: number }, users: User[], tasks: Task[], bids: Bid[] }} */
let store = {
  counters: { taskId: 10_000, bidId: 1, userId: 1 },
  users: [],
  tasks: [],
  bids: [],
};

let saveTimer = null;

const iso = () => new Date().toISOString();

function defaultUsers() {
  return [
    { id: 1, role: 'requester', name: 'Alex' },
    { id: 2, role: 'tasker', name: 'You' },
  ];
}

function ensureUsers() {
  if (!store.users.length) {
    store.users = defaultUsers();
    store.counters.userId = 3;
  }
}

function migrateLegacyTasksFile() {
  if (!fs.existsSync(LEGACY_FILE)) return;
  try {
    const raw = JSON.parse(fs.readFileSync(LEGACY_FILE, 'utf8'));
    if (!Array.isArray(raw.tasks) || store.tasks.length) return;
    ensureUsers();
    for (const row of raw.tasks) {
      store.tasks.push({
        id: row.id,
        requesterId: 1,
        text: row.text || '',
        status: row.status === 'Assigned' ? 'Assigned' : row.published ? 'Open' : 'Draft',
        published: !!row.published,
        title: row.title,
        cat: row.cat,
        acceptedBidId: row.bid ? store.counters.bidId : null,
        paymentStatus: row.status === 'Assigned' ? 'AUTHORISED' : 'none',
        updatedAt: row.updatedAt || iso(),
      });
      if (row.bid) {
        store.bids.push({
          id: store.counters.bidId++,
          taskId: row.id,
          taskerId: 2,
          taskerName: row.bid.taskerName || 'You',
          fee: row.bid.fee,
          status: 'accepted',
          at: row.bid.at || iso(),
        });
      }
      if (row.id >= store.counters.taskId) store.counters.taskId = row.id + 1;
    }
    persistNow();
  } catch {
    /* ignore bad legacy file */
  }
}

function loadStore() {
  try {
    if (fs.existsSync(STORE_FILE)) {
      store = JSON.parse(fs.readFileSync(STORE_FILE, 'utf8'));
      store.counters ||= { taskId: 10_000, bidId: 1, userId: 1 };
      store.users ||= [];
      store.tasks ||= [];
      store.bids ||= [];
    }
  } catch {
    store = { counters: { taskId: 10_000, bidId: 1, userId: 1 }, users: [], tasks: [], bids: [] };
  }
  ensureUsers();
  migrateLegacyTasksFile();
}

function persistNow() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(STORE_FILE, JSON.stringify(store, null, 2));
}

function schedulePersist() {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(persistNow, 400);
}

function findTask(id) {
  return store.tasks.find((t) => t.id === id) || null;
}

function bidsForTask(taskId) {
  return store.bids.filter((b) => b.taskId === taskId).map((b) => ({ ...b }));
}

function publicTask(task) {
  const bids = bidsForTask(task.id);
  const accepted = bids.find((b) => b.id === task.acceptedBidId) || bids.find((b) => b.status === 'accepted');
  return {
    ...task,
    bidCount: bids.filter((b) => b.status === 'pending').length,
    bids,
    bid: accepted
      ? { taskerName: accepted.taskerName, fee: accepted.fee, at: accepted.at, id: accepted.id }
      : undefined,
  };
}

export function getStoreSnapshot() {
  return JSON.parse(JSON.stringify(store));
}

export function listUsers() {
  return store.users.map((u) => ({ ...u }));
}

export function getTaskListing() {
  return store.tasks.map((t) => publicTask(t));
}

export function listPublishedTasks() {
  return store.tasks.filter((t) => t.published).map((t) => publicTask(t));
}

export function getTaskById(id) {
  const task = findTask(id);
  return task ? publicTask(task) : null;
}

export function upsertListingText(text, id) {
  ensureUsers();
  const body = String(text ?? '').slice(0, 8000);
  const now = iso();

  if (id != null) {
    const existing = findTask(id);
    if (existing) {
      existing.text = body;
      existing.updatedAt = now;
      if (!existing.published && existing.status === 'Draft') {
        /* keep draft */
      }
      schedulePersist();
      return publicTask(existing);
    }
  }

  const row = /** @type {Task} */ ({
    id: store.counters.taskId++,
    requesterId: 1,
    text: body,
    status: 'Draft',
    published: false,
    paymentStatus: 'none',
    updatedAt: now,
  });
  store.tasks.push(row);
  schedulePersist();
  return publicTask(row);
}

export function publishListing(id, meta = {}) {
  const row = findTask(id);
  if (!row) return null;
  row.text = meta.text ?? row.text;
  row.title = meta.title ?? row.title;
  row.cat = meta.cat ?? row.cat;
  row.published = true;
  row.status = 'Open';
  row.paymentStatus = 'none';
  row.updatedAt = iso();
  schedulePersist();
  return publicTask(row);
}

export function placeBid(id, { taskerName, fee, taskerId = 2 }) {
  const row = findTask(id);
  if (!row) return { error: 'Task not found', code: 404 };
  if (!row.published) return { error: 'Task is not published yet', code: 400 };
  if (row.status !== 'Open') return { error: 'Task is not open for bids', code: 409 };
  const amount = Number(fee);
  if (!Number.isFinite(amount) || amount < 5) return { error: 'Invalid bid amount', code: 400 };

  ensureUsers();
  const bid = /** @type {Bid} */ ({
    id: store.counters.bidId++,
    taskId: id,
    taskerId,
    taskerName: String(taskerName || 'Tasker').slice(0, 80),
    fee: amount,
    status: 'pending',
    at: iso(),
  });
  store.bids.push(bid);
  row.updatedAt = iso();
  schedulePersist();
  return { bid, task: publicTask(row) };
}

export function acceptBid(taskId, { bidId, taskerName, fee } = {}) {
  const row = findTask(taskId);
  if (!row) return { error: 'Task not found', code: 404 };
  if (row.status !== 'Open') return { error: 'Task is not open for acceptance', code: 409 };

  let bid = null;
  if (bidId != null) bid = store.bids.find((b) => b.id === bidId && b.taskId === taskId);
  else {
    const pending = store.bids.filter((b) => b.taskId === taskId && b.status === 'pending');
    if (fee != null) bid = pending.find((b) => b.fee === Number(fee));
    if (!bid && taskerName) bid = pending.find((b) => b.taskerName === taskerName);
    if (!bid) bid = pending[0];
  }

  if (!bid || bid.status !== 'pending') {
    return { error: 'No pending bid to accept', code: 404 };
  }

  bid.status = 'accepted';
  for (const b of store.bids) {
    if (b.taskId === taskId && b.id !== bid.id && b.status === 'pending') b.status = 'rejected';
  }

  row.status = 'Assigned';
  row.acceptedBidId = bid.id;
  row.paymentStatus = 'AUTHORISED';
  row.updatedAt = iso();
  schedulePersist();
  return { task: publicTask(row), bid: { ...bid } };
}

export function markStarted(taskId) {
  const row = findTask(taskId);
  if (!row) return { error: 'Task not found', code: 404 };
  if (row.status !== 'Assigned') return { error: 'Task must be Assigned before Started', code: 409 };
  row.status = 'Started';
  row.updatedAt = iso();
  schedulePersist();
  return { task: publicTask(row) };
}

export function markCompleted(taskId) {
  const row = findTask(taskId);
  if (!row) return { error: 'Task not found', code: 404 };
  if (row.status !== 'Started') return { error: 'Task must be Started before Completed', code: 409 };
  row.status = 'Completed';
  row.updatedAt = iso();
  schedulePersist();
  return { task: publicTask(row) };
}

export function approvePayment(taskId) {
  const row = findTask(taskId);
  if (!row) return { error: 'Task not found', code: 404 };
  if (row.status !== 'Completed') return { error: 'Task must be Completed before payment release', code: 409 };
  row.status = 'PaymentReleased';
  row.paymentStatus = 'RELEASED';
  row.updatedAt = iso();
  schedulePersist();
  return { task: publicTask(row) };
}

loadStore();
