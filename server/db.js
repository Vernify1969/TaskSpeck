import fs from 'fs';
import path from 'path';
import { hashPassword, verifyPassword, newSessionToken, hashToken } from './auth.js';
import { deliver } from './notify.js';
import { prohibitedReason, highRiskAnswer } from './safety.js';
import { registeredWorkReason } from '../shared/registeredWork.js';
import {
  resolveSuburb as resolveKnownSuburb,
  searchSuburbs,
  listCities,
  nearestSuburb,
  geocodeVictoria,
  snapRadius,
  RADII,
  launchRadiusKm,
  launchStatus,
  comingSoonMessage,
  LAUNCH_CENTER,
  extraOpenSuburbs,
} from '../shared/places.js';

const FEE_PCT = 15;
const RETIRED_CATS = new Set(['events', 'hosting']);

function retireCat(cat) {
  const name = String(cat || '');
  return RETIRED_CATS.has(name) ? 'other' : name;
}
const DEMO_TASKERS = new Set(['Jordan', 'Sam', 'Priya', 'Marco']);
const CONTACT_OR_CASH = /\bcash\b|bank transfer|\bbsb\b|pay ?id|paypal|venmo|osko|outside (of )?the app|off the app|pay me direct|whatsapp|my number|phone number|\b04\d{8}\b|\+61|call me on|text me/i;
export const CONTACT_WARNING = 'Please don’t swap phone numbers or pay cash. TaskSpeck can only protect a job that stays in the app.';

const BOOKED_STAGES = new Set([
  'ACCEPTED', 'PAYMENT_CONFIRMED', 'UPCOMING', 'TASK_STARTED', 'TASKER_COMPLETED',
  'FIX_REQUESTED', 'FIX_DONE', 'DISPUTED', 'REQUESTER_CONFIRMED', 'PAYMENT_RELEASED',
  'COMPLETED', 'RESOLVED',
]);

const PROOF_CATS = new Set(['rubbish', 'cleaning', 'furniture', 'home']);

function dataDir() {
  return process.env.TASKSPECK_DATA || path.join(process.cwd(), 'data');
}
function storeFile() {
  return path.join(dataDir(), 'store.json');
}
function legacyFile() {
  return path.join(dataDir(), 'tasks.json');
}

function emptyStore() {
  return {
    counters: {
      taskId: 10_000, bidId: 1, userId: 1, messageId: 1, notifId: 1,
      searchId: 1, shareId: 1, reviewId: 1, recordId: 1,
    },
    users: [],
    sessions: [],
    tasks: [],
    bids: [],
    messages: [],
    notifications: [],
    savedSearches: [],
    shares: [],
    reviews: [],
    records: [],
    outbox: [],
    geocodes: [],
    waitlist: [],
  };
}

/** @type {ReturnType<typeof emptyStore>} */
let store = emptyStore();
let saveTimer = null;

const iso = () => new Date().toISOString();

function defaultNotif() {
  return { offers: true, messages: true, reminders: true, nearby: false, email: true, sms: false };
}
function defaultAvail() {
  return { days: [1, 2, 3, 4, 5, 6], from: '09:00', to: '17:00', km: 10, cats: [], paused: false };
}

function resolveSuburb(name) {
  const raw = String(name || '').trim();
  if (!raw) return null;
  const key = raw.toLowerCase();
  const extra = (store.geocodes || []).find((g) => String(g.name || '').toLowerCase() === key);
  if (extra) return { name: extra.name, lat: extra.lat, lng: extra.lng, cityId: extra.cityId || 'victoria' };
  return resolveKnownSuburb(raw);
}

function pointFor(suburb) {
  const hit = resolveSuburb(suburb);
  if (!hit) return null;
  return { lat: hit.lat, lng: hit.lng, name: hit.name, cityId: hit.cityId };
}

export function catalogue(query) {
  return { cities: listCities(), radii: RADII, suburbs: searchSuburbs(query || '') };
}

export function nearestPlace(lat, lng) {
  return nearestSuburb(lat, lng);
}

export async function lookupVictoria(query) {
  const known = searchSuburbs(query);
  if (known.length === 1 && known[0].name.toLowerCase() === String(query || '').trim().toLowerCase()) {
    return { places: known };
  }
  const result = await geocodeVictoria(query);
  if (result.places) {
    for (const place of result.places) rememberGeocode(place);
  }
  return result;
}

function rememberGeocode(place) {
  store.geocodes ||= [];
  if (!place?.name) return;
  if (store.geocodes.some((g) => g.name.toLowerCase() === place.name.toLowerCase())) return;
  store.geocodes.push({ name: place.name, lat: place.lat, lng: place.lng, cityId: place.cityId || 'victoria' });
  schedulePersist();
}

export function distanceKm(lat1, lng1, lat2, lng2) {
  if ([lat1, lng1, lat2, lng2].some((v) => v == null || Number.isNaN(+v))) return 999;
  const R = 6371;
  const dLat = ((+lat2) - (+lat1)) * Math.PI / 180;
  const dLng = ((+lng2) - (+lng1)) * Math.PI / 180;
  const s = Math.sin(dLat / 2) ** 2
    + Math.cos((+lat1) * Math.PI / 180) * Math.cos((+lat2) * Math.PI / 180) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(s), Math.sqrt(1 - s));
}

function toMin(hhmm) {
  const [h, m] = String(hhmm || '0:0').split(':').map(Number);
  return (h || 0) * 60 + (m || 0);
}

function normalise() {
  store.counters ||= { taskId: 10_000, bidId: 1, userId: 1, messageId: 1, notifId: 1, searchId: 1, shareId: 1, reviewId: 1, recordId: 1 };
  for (const key of ['messageId', 'notifId', 'searchId', 'shareId', 'reviewId', 'recordId']) {
    if (!store.counters[key]) store.counters[key] = 1;
  }
  store.users ||= [];
  store.sessions ||= [];
  store.tasks ||= [];
  store.bids ||= [];
  store.messages ||= [];
  store.notifications ||= [];
  store.savedSearches ||= [];
  store.shares ||= [];
  store.reviews ||= [];
  store.records ||= [];
  store.outbox ||= [];
  store.geocodes ||= [];
  store.waitlist ||= [];
  for (const task of store.tasks) {
    if (RETIRED_CATS.has(task.cat)) task.cat = 'other';
    if (task.bundle && task.bundle.task && RETIRED_CATS.has(task.bundle.task.cat)) task.bundle.task.cat = 'other';
    if (!task.stage) task.stage = stageFromLegacy(task);
    const p = pointFor(task.suburb);
    if (p) {
      task.suburb = p.name;
      task.lat = p.lat;
      task.lng = p.lng;
      task.cityId = p.cityId;
    }
  }
  for (const user of store.users) {
    const p = pointFor(user.suburb);
    if (p) {
      user.suburb = p.name;
      user.lat = p.lat;
      user.lng = p.lng;
      user.cityId = p.cityId;
    }
    if (user.avail) {
      user.avail.km = snapRadius(user.avail.km);
      if (Array.isArray(user.avail.cats)) {
        user.avail.cats = [...new Set(user.avail.cats.map((cat) => retireCat(cat)))];
      }
    }
    user.demoMode = !!user.demoMode;
  }
  for (const search of store.savedSearches) {
    if (RETIRED_CATS.has(search.cat)) search.cat = 'other';
  }
  for (const record of store.records) {
    if (RETIRED_CATS.has(record.cat)) record.cat = 'other';
  }
}

function stageFromLegacy(task) {
  if (task.status === 'Assigned') return 'UPCOMING';
  if (task.status === 'Started') return 'TASK_STARTED';
  if (task.status === 'Completed') return 'TASKER_COMPLETED';
  if (task.status === 'PaymentReleased') return 'COMPLETED';
  if (task.status === 'Cancelled') return 'CANCELLED';
  if (task.published || task.status === 'Open') return 'POSTED';
  return 'Draft';
}

function loadStore() {
  try {
    if (fs.existsSync(storeFile())) {
      store = JSON.parse(fs.readFileSync(storeFile(), 'utf8'));
    }
  } catch {
    store = emptyStore();
  }
  normalise();
  migrateLegacyTasksFile();
}

function persistNow() {
  fs.mkdirSync(dataDir(), { recursive: true });
  const safe = JSON.parse(JSON.stringify(store));
  fs.writeFileSync(storeFile(), JSON.stringify(safe, null, 2));
}

function schedulePersist() {
  if (process.env.TASKSPECK_SYNC_SAVE === '1') {
    persistNow();
    return;
  }
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(persistNow, 400);
}

export function flushPersist() {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = null;
  persistNow();
}

export function resetStore() {
  store = emptyStore();
  persistNow();
}

function findUser(id) {
  return store.users.find((u) => u.id === id && !u.deletedAt) || null;
}
function findUserAny(id) {
  return store.users.find((u) => u.id === id) || null;
}
function findTask(id) {
  return store.tasks.find((t) => t.id === Number(id)) || null;
}
function findBid(id) {
  return store.bids.find((b) => b.id === Number(id)) || null;
}
function bidsForTask(taskId) {
  return store.bids.filter((b) => b.taskId === taskId);
}
function acceptedBid(task) {
  if (!task) return null;
  return bidsForTask(task.id).find((b) => b.id === task.acceptedBidId) || bidsForTask(task.id).find((b) => b.status === 'accepted') || null;
}
function acceptedTasker(task) {
  const bid = acceptedBid(task);
  if (!bid || !bid.taskerId) return null;
  return findUser(bid.taskerId);
}

export function publicUser(user) {
  if (!user) return null;
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    phone: user.phone || '',
    suburb: user.suburb || '',
    lat: user.lat ?? null,
    lng: user.lng ?? null,
    cityId: user.cityId || '',
    demoMode: !!user.demoMode,
    safetyGuide: !!user.safetyGuide,
    launch: launchForUser(user),
    bio: user.bio || '',
    areas: user.areas || '',
    vehicle: user.vehicle || '',
    langs: user.langs || ['English'],
    notif: { ...defaultNotif(), ...(user.notif || {}) },
    avail: { ...defaultAvail(), ...(user.avail || {}) },
    createdAt: user.createdAt,
    rating: user.rating ?? null,
    ratingCount: user.ratingCount || 0,
  };
}

function syncLegacy(task) {
  const s = task.stage;
  if (s === 'Draft' || s === 'UNDER_REVIEW') {
    task.status = 'Draft';
    task.published = false;
  } else if (s === 'POSTED' || s === 'OFFERS_RECEIVED') {
    task.status = 'Open';
    task.published = true;
  } else if (s === 'ACCEPTED' || s === 'PAYMENT_CONFIRMED' || s === 'UPCOMING') {
    task.status = 'Assigned';
    task.published = true;
    task.paymentStatus = task.payment?.status || 'AUTHORISED';
  } else if (s === 'TASK_STARTED' || s === 'FIX_REQUESTED' || s === 'DISPUTED') {
    task.status = 'Started';
    task.published = true;
  } else if (s === 'TASKER_COMPLETED' || s === 'FIX_DONE') {
    task.status = 'Completed';
    task.published = true;
  } else if (s === 'REQUESTER_CONFIRMED' || s === 'PAYMENT_RELEASED' || s === 'COMPLETED' || s === 'RESOLVED') {
    task.status = 'PaymentReleased';
    task.published = true;
    task.paymentStatus = task.payment?.status || 'RELEASED';
  } else if (s === 'NO_SHOW') {
    task.status = 'NoShow';
    task.published = false;
  } else if (s === 'CANCELLED' || s === 'EXPIRED') {
    task.status = 'Cancelled';
    task.published = false;
  }
}

function isBooked(task) {
  if (!task) return false;
  if (task.acceptedBidId) return true;
  if (BOOKED_STAGES.has(task.stage)) return true;
  if (['Assigned', 'Started', 'Completed', 'PaymentReleased'].includes(task.status)) return true;
  return false;
}

function requesterOf(task) {
  return findUserAny(task.requesterId);
}

function isRequester(task, user) {
  return !!(user && task && user.id === task.requesterId);
}
function isAcceptedTasker(task, user) {
  const bid = acceptedBid(task);
  return !!(user && bid && bid.taskerId === user.id);
}
function isParty(task, user) {
  return isRequester(task, user) || isAcceptedTasker(task, user);
}

function splitPay(gross) {
  const fee = Math.round(gross * FEE_PCT) / 100;
  const tasker = Math.round((gross - fee) * 100) / 100;
  return { gross, fee, tasker, status: 'AUTHORISED', callout: 0, partial: null, demo: process.env.TASKSPECK_DEMO === '1' };
}

function hoursUntilStart(task, now) {
  if (!task.startAt) return Infinity;
  const t = new Date(task.startAt).getTime();
  if (Number.isNaN(t)) return Infinity;
  return (t - now.getTime()) / 36e5;
}

function applyPolicyRefund(task, now) {
  const gross = task.payment?.gross || 0;
  const hours = hoursUntilStart(task, now);
  const late = hours < 24 && hours !== Infinity;
  const callout = late ? Math.round(gross * 20) / 100 : 0;
  task.payment = task.payment || splitPay(gross);
  task.payment.gross = gross;
  task.payment.callout = callout;
  if (!gross) {
    task.payment.status = 'none';
    task.paymentStatus = 'none';
    return { late, callout: 0, refund: 0 };
  }
  if (callout) {
    task.payment.status = 'PART_REFUND';
    task.paymentStatus = 'PART_REFUND';
  } else {
    task.payment.status = 'REFUNDED';
    task.paymentStatus = 'REFUNDED';
  }
  return { late, callout, refund: Math.round((gross - callout) * 100) / 100 };
}

function fullRefund(task) {
  if (!task.payment) return { refund: 0 };
  task.payment.callout = 0;
  task.payment.status = 'REFUNDED';
  task.paymentStatus = 'REFUNDED';
  return { refund: task.payment.gross || 0 };
}

function publicBid(bid) {
  return {
    id: bid.id,
    taskId: bid.taskId,
    taskerId: bid.taskerId,
    taskerName: bid.taskerName,
    fee: bid.fee,
    message: bid.message || '',
    status: bid.status,
    source: bid.source || 'tasker',
    at: bid.at,
    updatedAt: bid.updatedAt || bid.at,
  };
}

function showDemoBids(task, viewer) {
  return !!(viewer && viewer.demoMode && viewer.id === task.requesterId);
}

function visibleBids(task, viewer) {
  let bids = bidsForTask(task.id).map(publicBid);
  if (!showDemoBids(task, viewer)) bids = bids.filter((b) => b.source !== 'demo');
  if (viewer && viewer.id === task.requesterId) return bids;
  if (!viewer) return [];
  return bids.filter((b) => b.taskerId === viewer.id);
}

export function publicTask(task, viewer) {
  const bids = visibleBids(task, viewer);
  const all = bidsForTask(task.id);
  const accepted = all.find((b) => b.id === task.acceptedBidId) || all.find((b) => b.status === 'accepted');
  const party = isParty(task, viewer);
  const countDemo = showDemoBids(task, viewer);
  const pendingCount = all.filter((b) => b.status === 'pending' && (countDemo || b.source !== 'demo')).length;
  const acceptedPublic = accepted && (accepted.source !== 'demo' || countDemo) ? accepted : null;
  const base = {
    id: task.id,
    requesterId: task.requesterId,
    requesterName: task.requesterName || requesterOf(task)?.name || 'Requester',
    text: task.text || '',
    title: task.title || '',
    cat: retireCat(task.cat) || 'other',
    status: task.status,
    stage: task.stage,
    published: !!task.published,
    acceptedBidId: task.acceptedBidId || null,
    paymentStatus: task.paymentStatus || 'none',
    suburb: task.suburb || '',
    lat: task.lat,
    lng: task.lng,
    date: task.date || null,
    startAt: task.startAt || null,
    startMin: task.startMin ?? null,
    durationMin: task.durationMin ?? null,
    budgetLabel: task.budgetLabel || 'Open to offers',
    priceNum: task.priceNum ?? null,
    photoCount: task.photoCount || 0,
    bidCount: pendingCount,
    updatedAt: task.updatedAt,
    createdAt: task.createdAt,
    bid: acceptedPublic
      ? { taskerName: acceptedPublic.taskerName, fee: acceptedPublic.fee, at: acceptedPublic.at, id: acceptedPublic.id, demo: acceptedPublic.source === 'demo' }
      : undefined,
    milestones: (task.milestones || []).map((m) => ({ ...m })),
  };
  if (!party && !(viewer && viewer.id === task.requesterId)) {
    return { ...base, bids };
  }
  return {
    ...base,
    bids,
    address: task.address || '',
    propPrivate: task.propPrivate || '',
    payment: task.payment || null,
    fixes: task.fixes || [],
    dispute: task.dispute || null,
    fixUsed: !!task.fixUsed,
    bundle: task.requesterId === viewer?.id || isAcceptedTasker(task, viewer) ? task.bundle || null : null,
    notes: task.notes || [],
    special: task.special || [],
    reviews: store.reviews.filter((r) => r.taskId === task.id).map((r) => ({
      stars: r.stars,
      text: r.text,
      name: findUserAny(r.fromUserId)?.name || 'Demo',
    })),
  };
}

function briefTask(task) {
  if (!task) return null;
  return {
    id: task.id,
    title: task.title || '',
    cat: retireCat(task.cat) || 'other',
    suburb: task.suburb || '',
    status: task.status,
    stage: task.stage,
    date: task.date || null,
    budgetLabel: task.budgetLabel || '',
  };
}

function requireUser(user) {
  if (!user || user.deletedAt) return { error: 'Sign in required', code: 401 };
  return null;
}

function emailOk(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email || '').trim());
}

export function signup({ email, password, name, phone }) {
  const clean = String(email || '').trim().toLowerCase();
  const display = String(name || '').trim().slice(0, 80);
  if (!display || display.length < 2) return { error: 'Add your name', code: 400 };
  if (!emailOk(clean)) return { error: 'Enter a valid email address', code: 400 };
  if (String(password || '').length < 8) return { error: 'Use at least 8 characters for the password', code: 400 };
  if (store.users.some((u) => u.email === clean && !u.deletedAt)) return { error: 'An account with that email already exists', code: 409 };
  const user = {
    id: store.counters.userId++,
    email: clean,
    password: hashPassword(password),
    name: display,
    phone: String(phone || '').trim().slice(0, 30),
    suburb: '',
    lat: null,
    lng: null,
    cityId: 'melbourne',
    demoMode: false,
    bio: '',
    areas: '',
    vehicle: '',
    langs: ['English'],
    notif: defaultNotif(),
    avail: defaultAvail(),
    createdAt: iso(),
    deletedAt: null,
    rating: null,
    ratingCount: 0,
  };
  store.users.push(user);
  const session = openSession(user.id);
  schedulePersist();
  return { user: publicUser(user), token: session.token };
}

function openSession(userId) {
  const token = newSessionToken();
  store.sessions.push({
    tokenHash: hashToken(token),
    userId,
    createdAt: iso(),
    expiresAt: new Date(Date.now() + 30 * 24 * 3600 * 1000).toISOString(),
  });
  schedulePersist();
  return { token };
}

export function login({ email, password }) {
  const clean = String(email || '').trim().toLowerCase();
  const user = store.users.find((u) => u.email === clean && !u.deletedAt);
  if (!user || !verifyPassword(password, user.password)) {
    return { error: 'Email or password is not right', code: 401 };
  }
  const session = openSession(user.id);
  return { user: publicUser(user), token: session.token };
}

export function logout(token) {
  if (!token) return { ok: true };
  const hash = hashToken(token);
  store.sessions = store.sessions.filter((s) => s.tokenHash !== hash);
  schedulePersist();
  return { ok: true };
}

export function userFromToken(token) {
  if (!token) return null;
  const hash = hashToken(token);
  const session = store.sessions.find((s) => s.tokenHash === hash);
  if (!session) return null;
  if (new Date(session.expiresAt).getTime() < Date.now()) return null;
  return findUser(session.userId);
}

export function updateProfile(user, patch = {}) {
  const gate = requireUser(user);
  if (gate) return gate;
  if (patch.name != null) {
    const name = String(patch.name).trim().slice(0, 80);
    if (name.length < 2) return { error: 'Add your name', code: 400 };
    user.name = name;
  }
  if (patch.phone != null) user.phone = String(patch.phone).trim().slice(0, 30);
  if (patch.bio != null) user.bio = String(patch.bio).trim().slice(0, 600);
  if (patch.areas != null) user.areas = String(patch.areas).trim().slice(0, 160);
  if (patch.vehicle != null) user.vehicle = String(patch.vehicle).trim().slice(0, 80);
  if (patch.suburb != null) {
    const hit = resolveSuburb(patch.suburb);
    if (!hit) return { error: 'Choose a suburb from the list.', code: 400 };
    user.suburb = hit.name;
    user.lat = hit.lat;
    user.lng = hit.lng;
    user.cityId = hit.cityId;
  }
  if (patch.demoMode != null) user.demoMode = !!patch.demoMode;
  if (patch.safetyGuide != null) user.safetyGuide = !!patch.safetyGuide;
  if (patch.notif && typeof patch.notif === 'object') {
    user.notif = { ...defaultNotif(), ...user.notif, ...pickBool(patch.notif, ['offers', 'messages', 'reminders', 'nearby', 'email', 'sms']) };
  }
  if (patch.avail && typeof patch.avail === 'object') {
    const a = patch.avail;
    user.avail = { ...defaultAvail(), ...user.avail };
    if (Array.isArray(a.days)) user.avail.days = a.days.map(Number).filter((n) => n >= 0 && n <= 6);
    if (a.from) user.avail.from = String(a.from).slice(0, 5);
    if (a.to) user.avail.to = String(a.to).slice(0, 5);
    if (a.km != null) user.avail.km = snapRadius(a.km);
    if (Array.isArray(a.cats)) user.avail.cats = [...new Set(a.cats.map((cat) => retireCat(String(cat))))].slice(0, 12);
    if (a.paused != null) user.avail.paused = !!a.paused;
  }
  schedulePersist();
  return { user: publicUser(user) };
}

function pickBool(obj, keys) {
  const out = {};
  for (const k of keys) if (obj[k] != null) out[k] = !!obj[k];
  return out;
}

export function deleteAccount(user) {
  const gate = requireUser(user);
  if (gate) return gate;
  for (const task of store.tasks) {
    if (task.requesterId !== user.id) continue;
    if (['CANCELLED', 'COMPLETED', 'PAYMENT_RELEASED', 'RESOLVED', 'EXPIRED'].includes(task.stage)) continue;
    if (task.payment && task.payment.status === 'AUTHORISED') fullRefund(task);
    task.stage = 'CANCELLED';
    task.published = false;
    syncLegacy(task);
    task.updatedAt = iso();
  }
  for (const bid of store.bids) {
    if (bid.taskerId === user.id && bid.status === 'pending') bid.status = 'withdrawn';
  }
  store.sessions = store.sessions.filter((s) => s.userId !== user.id);
  store.savedSearches = store.savedSearches.filter((s) => s.userId !== user.id);
  store.notifications = store.notifications.filter((n) => n.userId !== user.id);
  store.shares = store.shares.filter((s) => s.userId !== user.id);
  user.deletedAt = iso();
  user.email = `deleted-${user.id}@deleted.taskspeck.local`;
  user.password = null;
  user.name = 'Deleted user';
  user.phone = '';
  user.bio = '';
  user.address = '';
  schedulePersist();
  return { ok: true };
}

function prefAllows(user, kind) {
  const n = { ...defaultNotif(), ...(user.notif || {}) };
  if (kind === 'search') return true;
  if (kind === 'offer' || kind === 'booking') return n.offers !== false;
  if (kind === 'message') return n.messages !== false;
  if (kind === 'jobday' || kind === 'payment') return n.reminders !== false;
  if (kind === 'nearby') return n.nearby === true;
  return true;
}

export async function notifyUser(user, { kind, title, body, taskId }) {
  if (!user || user.deletedAt) return null;
  if (!prefAllows(user, kind)) return null;
  const note = {
    id: store.counters.notifId++,
    userId: user.id,
    kind,
    title: String(title || 'TaskSpeck').slice(0, 140),
    body: String(body || '').slice(0, 500),
    taskId: taskId || null,
    read: false,
    at: iso(),
  };
  store.notifications.push(note);
  const n = { ...defaultNotif(), ...(user.notif || {}) };
  const subject = note.title;
  if (n.email !== false && user.email && !user.email.endsWith('@deleted.taskspeck.local')) {
    const sent = await deliver({ channel: 'email', to: user.email, subject, body: note.body, kind, taskId: note.taskId });
    store.outbox.push(sent);
  }
  if (n.sms === true && user.phone) {
    const sent = await deliver({ channel: 'sms', to: user.phone, subject, body: note.body, kind, taskId: note.taskId });
    store.outbox.push(sent);
  }
  schedulePersist();
  return note;
}

export function taskerMatchesAvailability(user, task) {
  if (!user || user.deletedAt || !task) return false;
  if (user.id === task.requesterId) return false;
  const home = pointFor(user.suburb);
  if (!home || !launchStatus(home).open) return false;
  const a = { ...defaultAvail(), ...(user.avail || {}) };
  if (a.paused) return false;
  if (Array.isArray(a.cats) && a.cats.length && task.cat && !a.cats.includes(task.cat)) return false;
  const km = distanceKm(user.lat, user.lng, task.lat, task.lng);
  if (Number.isFinite(+a.km) && km > +a.km + 0.05) return false;
  if (task.startAt) {
    const d = new Date(task.startAt);
    if (!Number.isNaN(d.getTime())) {
      if (Array.isArray(a.days) && a.days.length && !a.days.map(Number).includes(d.getDay())) return false;
      if (task.startMin != null && a.from && a.to) {
        const start = Number(task.startMin);
        if (start < toMin(a.from) || start > toMin(a.to)) return false;
      }
    }
  }
  return true;
}

function savedDistanceKm(value) {
  if (value == null || value === '') return null;
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.min(10, Math.max(1, Math.round(n)));
}

function searchMatches(search, task, user) {
  if (search.cat && search.cat !== 'all' && task.cat !== search.cat) return false;
  if (search.km == null || search.km === '') {
    const fromCentre = distanceKm(LAUNCH_CENTER.lat, LAUNCH_CENTER.lng, task.lat, task.lng);
    if (fromCentre > launchRadiusKm() + 0.05) return false;
  } else {
    const originLat = search.lat ?? user?.lat;
    const originLng = search.lng ?? user?.lng;
    const km = distanceKm(originLat, originLng, task.lat, task.lng);
    if (km > Number(search.km) + 0.05) return false;
  }
  if (search.maxPrice != null && search.maxPrice !== '' && task.priceNum != null && task.priceNum > Number(search.maxPrice)) return false;
  const q = String(search.q || '').trim().toLowerCase();
  if (q) {
    const hay = `${task.title || ''} ${task.text || ''} ${task.suburb || ''} ${task.cat || ''}`.toLowerCase();
    const words = q.split(/[^a-z0-9]+/).filter((w) => w.length > 2);
    if (words.length && !words.some((w) => hay.includes(w))) return false;
  }
  return true;
}

async function fanoutNewTask(task) {
  const told = new Set();
  for (const user of store.users) {
    if (!taskerMatchesAvailability(user, task)) continue;
    const searches = store.savedSearches.filter((s) => s.userId === user.id && s.alert);
    const hit = searches.find((s) => searchMatches(s, task, user));
    if (hit) {
      await notifyUser(user, {
        kind: 'search',
        title: 'Saved search match',
        body: `A new task matches your saved search: ${task.title || 'New task'} in ${task.suburb}.`,
        taskId: task.id,
      });
      told.add(user.id);
      continue;
    }
    if (user.notif?.nearby) {
      await notifyUser(user, {
        kind: 'nearby',
        title: 'New task nearby',
        body: `${task.title || 'A new task'} is in ${task.suburb}.`,
        taskId: task.id,
      });
      told.add(user.id);
    }
  }
  return told.size;
}

function launchForUser(user) {
  const place = user ? pointFor(user.suburb) : null;
  const zone = place ? launchStatus(place) : { open: false, km: null, reason: 'unknown' };
  return {
    open: !!zone.open,
    radiusKm: launchRadiusKm(),
    center: LAUNCH_CENTER,
    kmFromCentre: zone.km,
    extra: zone.reason === 'extra',
    extraSuburbs: extraOpenSuburbs(),
  };
}

export function zoneFor(name) {
  const place = resolveSuburb(name);
  const zone = place ? launchStatus(place) : { open: false, km: null, reason: 'unknown' };
  return { suburb: place?.name || '', ...zone, radiusKm: launchRadiusKm(), center: LAUNCH_CENTER };
}

export function joinWaitlist({ email, suburb, name }) {
  const clean = String(email || '').trim().toLowerCase();
  if (!emailOk(clean)) return { error: 'Enter a valid email address', code: 400 };
  const place = resolveSuburb(suburb);
  if (!place) return { error: 'Choose a suburb from the list.', code: 400 };
  if (launchStatus(place).open) return { error: 'That suburb is already open. You can sign up and post a task.', code: 400 };
  store.waitlist ||= [];
  const existing = store.waitlist.find((w) => w.email === clean && w.suburb.toLowerCase() === place.name.toLowerCase());
  if (existing) return { entry: { ...existing }, already: true };
  const entry = { id: (store.counters.waitId = (store.counters.waitId || 1), store.counters.waitId++), email: clean, name: String(name || '').slice(0, 80), suburb: place.name, createdAt: iso() };
  store.waitlist.push(entry);
  schedulePersist();
  return { entry: { ...entry } };
}

export function waitlistCsv() {
  const lines = ['email,name,suburb,joined'];
  for (const w of store.waitlist || []) {
    lines.push([w.email, w.name, w.suburb, w.createdAt].map((v) => {
      const s = v == null ? '' : String(v);
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    }).join(','));
  }
  return lines.join('\n') + '\n';
}

export async function releaseMilestone(taskId, milestoneId, user) {
  const gate = requireUser(user);
  if (gate) return gate;
  const task = findTask(taskId);
  if (!task) return { error: 'Task not found', code: 404 };
  if (!isRequester(task, user)) return { error: 'Only the requester can release a payment stage', code: 403 };
  if (!['TASK_STARTED', 'TASKER_COMPLETED', 'FIX_DONE', 'FIX_REQUESTED', 'REQUESTER_CONFIRMED'].includes(task.stage)) {
    return { error: 'A stage stays held until the work on it has started', code: 409 };
  }
  if (task.payment?.status === 'DISPUTED' || task.stage === 'DISPUTED') return { error: 'Payment is on hold until the problem is resolved', code: 409 };
  const milestone = (task.milestones || []).find((m) => m.id === Number(milestoneId));
  if (!milestone) return { error: 'That payment stage was not found', code: 404 };
  if (milestone.status === 'released') return { error: 'That stage is already released', code: 409 };
  milestone.status = 'released';
  const allOut = task.milestones.every((m) => m.status === 'released');
  if (allOut && task.payment) {
    task.payment.status = 'RELEASED';
    task.paymentStatus = 'RELEASED';
    task.stage = 'COMPLETED';
    syncLegacy(task);
  }
  task.updatedAt = iso();
  schedulePersist();
  return { task: publicTask(task, user), milestone: { ...milestone } };
}

function applyMeta(task, meta, user) {
  if (meta.text != null) task.text = String(meta.text).slice(0, 8000);
  if (meta.title != null) task.title = String(meta.title).slice(0, 140);
  if (meta.cat != null) task.cat = retireCat(String(meta.cat)).slice(0, 40);
  if (meta.address != null) task.address = String(meta.address).slice(0, 200);
  if (meta.prop != null) task.propPrivate = String(meta.prop).slice(0, 200);
  if (meta.budgetLabel != null) task.budgetLabel = String(meta.budgetLabel).slice(0, 80);
  if (meta.priceNum != null && meta.priceNum !== '') task.priceNum = Number(meta.priceNum) || null;
  if (meta.date != null) task.date = meta.date ? String(meta.date).slice(0, 40) : null;
  if (meta.startAt != null) task.startAt = meta.startAt ? String(meta.startAt) : null;
  if (meta.startMin != null && meta.startMin !== '') task.startMin = Number(meta.startMin);
  if (meta.durationMin != null && meta.durationMin !== '') task.durationMin = Number(meta.durationMin);
  if (meta.photoCount != null) task.photoCount = Math.min(8, Number(meta.photoCount) || 0);
  if (Array.isArray(meta.notes)) task.notes = meta.notes.map((n) => String(n).slice(0, 300)).slice(0, 12);
  if (Array.isArray(meta.special)) task.special = meta.special.map((n) => String(n).slice(0, 300)).slice(0, 12);
  if (Array.isArray(meta.milestones)) {
    const cleaned = cleanMilestones(meta.milestones, task.priceNum);
    if (cleaned.error) return cleaned;
    task.milestones = cleaned;
  }
  const suburbName = meta.suburb != null ? meta.suburb : (task.suburb || user?.suburb || '');
  const hit = resolveSuburb(suburbName);
  if (!hit) return { error: 'Choose a suburb for this task.', code: 400 };
  const zone = launchStatus(hit);
  if (!zone.open) return { error: comingSoonMessage(), code: 403 };
  task.suburb = hit.name;
  task.lat = hit.lat;
  task.lng = hit.lng;
  task.cityId = hit.cityId;
  return null;
}

function cleanMilestones(list, priceNum) {
  const rows = list.map((m, i) => ({
    id: i + 1,
    title: String(m.title || `Stage ${i + 1}`).slice(0, 80),
    amount: Math.round(Number(m.amount) * 100) / 100,
    status: 'held',
  })).filter((m) => m.title && m.amount > 0);
  if (!rows.length) return [];
  if (rows.length < 2) return { error: 'Add at least two payment stages, or leave stages off.', code: 400 };
  if (priceNum) {
    const sum = Math.round(rows.reduce((s, m) => s + m.amount, 0) * 100) / 100;
    if (Math.abs(sum - Number(priceNum)) > 1) return { error: 'Stage amounts need to add up to the fixed price.', code: 400 };
  }
  return rows;
}

export function upsertListingText(text, id, user) {
  const gate = requireUser(user);
  if (gate) return gate;
  const body = String(text ?? '').slice(0, 8000);
  const now = iso();
  if (id != null) {
    const existing = findTask(id);
    if (!existing) return { error: 'Task not found', code: 404 };
    if (existing.requesterId !== user.id) return { error: 'You can only edit your own draft', code: 403 };
    if (isBooked(existing) || ['CANCELLED', 'NO_SHOW', 'COMPLETED'].includes(existing.stage)) {
      return { error: 'This task can no longer be edited as a draft', code: 409 };
    }
    existing.text = body;
    existing.updatedAt = now;
    schedulePersist();
    return { task: publicTask(existing, user) };
  }
  const row = {
    id: store.counters.taskId++,
    requesterId: user.id,
    requesterName: user.name,
    text: body,
    title: '',
    cat: 'other',
    status: 'Draft',
    stage: 'Draft',
    published: false,
    acceptedBidId: null,
    paymentStatus: 'none',
    payment: null,
    address: '',
    suburb: user.suburb || '',
    date: null,
    startAt: null,
    startMin: null,
    durationMin: null,
    budgetLabel: 'Open to offers',
    priceNum: null,
    photoCount: 0,
    notes: [],
    special: [],
    fixes: [],
    dispute: null,
    fixUsed: false,
    bundle: null,
    jobDayNotified: false,
    propPrivate: '',
    createdAt: now,
    updatedAt: now,
  };
  const point = pointFor(row.suburb);
  row.lat = point ? point.lat : null;
  row.lng = point ? point.lng : null;
  row.cityId = point ? point.cityId : '';
  if (point) row.suburb = point.name;
  store.tasks.push(row);
  schedulePersist();
  return { task: publicTask(row, user) };
}

export async function publishListing(id, meta = {}, user) {
  const gate = requireUser(user);
  if (gate) return gate;
  const row = findTask(id);
  if (!row) return { error: 'Task not found', code: 404 };
  if (row.requesterId !== user.id) return { error: 'Only the person who posted this task can publish it', code: 403 };
  if (isBooked(row) || ['CANCELLED', 'NO_SHOW', 'COMPLETED', 'PAYMENT_RELEASED', 'RESOLVED'].includes(row.stage)) {
    return { error: 'A booked task cannot be opened again. Post a new task instead.', code: 409 };
  }
  const nextText = meta.text != null ? String(meta.text) : row.text;
  const blocked = prohibitedReason(nextText) || highRiskAnswer(meta.answers || {});
  if (blocked) return { error: blocked, code: 400 };
  const nextCat = meta.cat != null ? String(meta.cat) : row.cat;
  const nextTitle = meta.title != null ? String(meta.title) : row.title;
  const overLimit = registeredWorkReason(
    { cat: nextCat, text: `${nextTitle || ''} ${nextText || ''}`, title: nextTitle },
    {
      priceNum: meta.priceNum != null && meta.priceNum !== '' ? meta.priceNum : row.priceNum,
      budgetLabel: meta.budgetLabel != null ? meta.budgetLabel : row.budgetLabel,
      milestones: Array.isArray(meta.milestones) ? meta.milestones : row.milestones,
    },
  );
  if (overLimit) return { error: overLimit, code: 400 };

  const wasLive = row.published && (row.stage === 'POSTED' || row.stage === 'OFFERS_RECEIVED' || row.status === 'Open');
  const located = applyMeta(row, meta, user);
  if (located && located.error) return located;
  row.requesterName = user.name;
  if (!wasLive) {
    row.published = true;
    row.stage = 'POSTED';
    row.paymentStatus = 'none';
    row.payment = null;
    row.acceptedBidId = null;
    syncLegacy(row);
    row.updatedAt = iso();
    schedulePersist();
    await fanoutNewTask(row);
    return { task: publicTask(row, user) };
  }
  syncLegacy(row);
  row.updatedAt = iso();
  schedulePersist();
  return { task: publicTask(row, user) };
}

export async function placeBid(id, { taskerName, fee, message } = {}, user) {
  const gate = requireUser(user);
  if (gate) return gate;
  const row = findTask(id);
  if (!row) return { error: 'Task not found', code: 404 };
  if (!row.published || !['POSTED', 'OFFERS_RECEIVED'].includes(row.stage)) {
    return { error: 'Task is not open for offers', code: 409 };
  }
  const amount = Number(fee);
  if (!Number.isFinite(amount) || amount <= 0 || amount > 10_000_000) return { error: 'Enter a price above $0.', code: 400 };
  const overLimit = registeredWorkReason(
    { cat: row.cat, text: `${row.title || ''} ${row.text || ''}`, title: row.title },
    { fee: amount },
  );
  if (overLimit) return { error: overLimit, code: 400 };

  const demoName = String(taskerName || '').trim();
  const asDemo = user.id === row.requesterId && DEMO_TASKERS.has(demoName);
  if (asDemo && !user.demoMode) return { error: 'Sample offers are off. Turn on Demo mode if you want to try them.', code: 403 };
  if (user.id === row.requesterId && !asDemo) {
    return { error: 'You cannot make an offer on your own task', code: 403 };
  }
  if (!asDemo) {
    const home = pointFor(user.suburb);
    if (!home || !launchStatus(home).open) return { error: comingSoonMessage(), code: 403 };
  }
  if (!asDemo) {
    const dup = store.bids.find((b) => b.taskId === row.id && b.taskerId === user.id && (b.status === 'pending' || b.status === 'accepted'));
    if (dup) return { error: 'You already sent an offer for this task', code: 409 };
  } else {
    const dup = store.bids.find((b) => b.taskId === row.id && b.source === 'demo' && b.taskerName === demoName && b.status === 'pending');
    if (dup) return { bid: publicBid(dup), task: publicTask(row, user) };
  }

  const bid = {
    id: store.counters.bidId++,
    taskId: row.id,
    taskerId: asDemo ? null : user.id,
    taskerName: asDemo ? demoName : user.name,
    fee: amount,
    message: String(message || '').slice(0, 1000),
    status: 'pending',
    source: asDemo ? 'demo' : 'tasker',
    at: iso(),
    updatedAt: iso(),
  };
  store.bids.push(bid);
  if (row.stage === 'POSTED') row.stage = 'OFFERS_RECEIVED';
  syncLegacy(row);
  row.updatedAt = iso();
  if (!asDemo) {
    const requester = findUser(row.requesterId);
    await notifyUser(requester, {
      kind: 'offer',
      title: 'New offer',
      body: `${user.name} offered $${amount} for "${row.title || 'your task'}".`,
      taskId: row.id,
    });
  }
  schedulePersist();
  return { bid: publicBid(bid), task: publicTask(row, user) };
}

export function updateBid(bidId, { fee, message } = {}, user) {
  const gate = requireUser(user);
  if (gate) return gate;
  const bid = findBid(bidId);
  if (!bid) return { error: 'Offer not found', code: 404 };
  if (bid.taskerId !== user.id) return { error: 'You can only edit your own offer', code: 403 };
  if (bid.status !== 'pending') return { error: 'Only a waiting offer can be edited', code: 409 };
  const task = findTask(bid.taskId);
  if (!task || !['POSTED', 'OFFERS_RECEIVED'].includes(task.stage)) {
    return { error: 'This task is no longer taking offers', code: 409 };
  }
  if (fee != null) {
    const amount = Number(fee);
    if (!Number.isFinite(amount) || amount <= 0 || amount > 10_000_000) return { error: 'Enter a price above $0.', code: 400 };
    const overLimit = registeredWorkReason(
      { cat: task.cat, text: `${task.title || ''} ${task.text || ''}`, title: task.title },
      { fee: amount },
    );
    if (overLimit) return { error: overLimit, code: 400 };
    bid.fee = amount;
  }
  if (message != null) bid.message = String(message).slice(0, 1000);
  bid.updatedAt = iso();
  task.updatedAt = iso();
  schedulePersist();
  return { bid: publicBid(bid), task: publicTask(task, user) };
}

export async function withdrawBid(bidId, user) {
  const gate = requireUser(user);
  if (gate) return gate;
  const bid = findBid(bidId);
  if (!bid) return { error: 'Offer not found', code: 404 };
  if (bid.taskerId !== user.id) return { error: 'You can only withdraw your own offer', code: 403 };
  if (bid.status !== 'pending') return { error: 'Only a waiting offer can be withdrawn', code: 409 };
  bid.status = 'withdrawn';
  bid.updatedAt = iso();
  const task = findTask(bid.taskId);
  if (task) {
    task.updatedAt = iso();
    const requester = findUser(task.requesterId);
    await notifyUser(requester, {
      kind: 'offer',
      title: 'Offer withdrawn',
      body: `${user.name} withdrew their offer on "${task.title || 'your task'}".`,
      taskId: task.id,
    });
  }
  schedulePersist();
  return { bid: publicBid(bid), task: task ? publicTask(task, user) : null };
}

export async function acceptBid(taskId, { bidId, taskerName, fee } = {}, user) {
  const gate = requireUser(user);
  if (gate) return gate;
  const row = findTask(taskId);
  if (!row) return { error: 'Task not found', code: 404 };
  if (row.requesterId !== user.id) return { error: 'Only the requester can accept an offer', code: 403 };
  if (!['POSTED', 'OFFERS_RECEIVED'].includes(row.stage)) {
    return { error: 'This task is not open for acceptance', code: 409 };
  }

  let bid = null;
  if (bidId != null) bid = store.bids.find((b) => b.id === Number(bidId) && b.taskId === row.id);
  else {
    const pending = store.bids.filter((b) => b.taskId === row.id && b.status === 'pending');
    if (taskerName) bid = pending.find((b) => b.taskerName === taskerName && (fee == null || b.fee === Number(fee)));
    if (!bid && fee != null) bid = pending.find((b) => b.fee === Number(fee));
  }
  if (!bid || bid.status !== 'pending') {
    return { error: 'No pending offer matches that Tasker. It may have been withdrawn. Refresh and try again.', code: 404 };
  }
  const overLimit = registeredWorkReason(
    { cat: row.cat, text: `${row.title || ''} ${row.text || ''}`, title: row.title },
    { fee: bid.fee, priceNum: row.priceNum, budgetLabel: row.budgetLabel, milestones: row.milestones },
  );
  if (overLimit) return { error: overLimit, code: 400 };

  bid.status = 'accepted';
  bid.updatedAt = iso();
  for (const other of store.bids) {
    if (other.taskId === row.id && other.id !== bid.id && other.status === 'pending') other.status = 'rejected';
  }
  row.acceptedBidId = bid.id;
  row.stage = 'UPCOMING';
  row.payment = splitPay(bid.fee);
  row.paymentStatus = 'AUTHORISED';
  syncLegacy(row);
  row.updatedAt = iso();

  const requester = findUser(row.requesterId);
  await notifyUser(requester, {
    kind: 'booking',
    title: 'Booking confirmed',
    body: `${bid.taskerName} is booked for "${row.title || 'your task'}". Payment is held until the job is done.`,
    taskId: row.id,
  });
  if (bid.taskerId) {
    const tasker = findUser(bid.taskerId);
    await notifyUser(tasker, {
      kind: 'booking',
      title: 'You are booked',
      body: `${user.name} accepted your offer of $${bid.fee} for "${row.title || 'a task'}".`,
      taskId: row.id,
    });
  }
  schedulePersist();
  return { task: publicTask(row, user), bid: publicBid(bid) };
}

function partyError(task, user) {
  if (!isParty(task, user)) return { error: 'You are not part of this task', code: 403 };
  return null;
}

export async function cancelTask(taskId, user, { reason } = {}, now = new Date()) {
  const gate = requireUser(user);
  if (gate) return gate;
  const task = findTask(taskId);
  if (!task) return { error: 'Task not found', code: 404 };
  const who = partyError(task, user);
  if (who) return who;
  const allowed = ['POSTED', 'OFFERS_RECEIVED', 'ACCEPTED', 'PAYMENT_CONFIRMED', 'UPCOMING', 'TASK_STARTED'];
  if (!allowed.includes(task.stage)) return { error: 'This task cannot be cancelled at this stage', code: 409 };
  const money = task.payment && task.payment.status === 'AUTHORISED' ? applyPolicyRefund(task, now) : { late: false, callout: 0, refund: 0 };
  task.stage = 'CANCELLED';
  task.cancelReason = String(reason || '').slice(0, 200);
  syncLegacy(task);
  task.updatedAt = iso();
  const other = isRequester(task, user) ? acceptedTasker(task) : findUser(task.requesterId);
  await notifyUser(other, {
    kind: 'payment',
    title: 'Task cancelled',
    body: `"${task.title || 'A task'}" was cancelled.${money.refund ? ` Refund: $${money.refund}.` : ''}`,
    taskId: task.id,
  });
  schedulePersist();
  return { task: publicTask(task, user), refund: money };
}

export async function reportNoShow(taskId, user) {
  const gate = requireUser(user);
  if (gate) return gate;
  const task = findTask(taskId);
  if (!task) return { error: 'Task not found', code: 404 };
  if (!isRequester(task, user)) return { error: 'Only the requester can report a no-show', code: 403 };
  if (!['UPCOMING', 'ACCEPTED', 'PAYMENT_CONFIRMED'].includes(task.stage)) {
    return { error: 'A no-show can only be reported before the job has started', code: 409 };
  }
  const money = fullRefund(task);
  task.stage = 'NO_SHOW';
  const bid = acceptedBid(task);
  if (bid) bid.status = 'noshow';
  syncLegacy(task);
  task.updatedAt = iso();
  if (bid?.taskerId) {
    await notifyUser(findUser(bid.taskerId), {
      kind: 'booking',
      title: 'No-show reported',
      body: `A no-show was reported on "${task.title || 'a task'}".`,
      taskId: task.id,
    });
  }
  await notifyUser(user, {
    kind: 'payment',
    title: 'Refund on the way',
    body: `Full refund of $${money.refund || 0} for the no-show. You can re-match this task.`,
    taskId: task.id,
  });
  schedulePersist();
  return { task: publicTask(task, user), refund: money };
}

export function rematchTask(taskId, user) {
  const gate = requireUser(user);
  if (gate) return gate;
  const task = findTask(taskId);
  if (!task) return { error: 'Task not found', code: 404 };
  if (!isRequester(task, user)) return { error: 'Only the requester can re-match this task', code: 403 };
  if (task.stage !== 'NO_SHOW') return { error: 'Re-match is available after a no-show', code: 409 };
  task.acceptedBidId = null;
  task.payment = null;
  task.paymentStatus = 'none';
  task.stage = 'OFFERS_RECEIVED';
  task.jobDayNotified = false;
  syncLegacy(task);
  task.updatedAt = iso();
  schedulePersist();
  return { task: publicTask(task, user) };
}

export async function requestFix(taskId, user, { what, text } = {}) {
  const gate = requireUser(user);
  if (gate) return gate;
  const task = findTask(taskId);
  if (!task) return { error: 'Task not found', code: 404 };
  if (!isRequester(task, user)) return { error: 'Only the requester can ask for a fix', code: 403 };
  if (!['TASKER_COMPLETED', 'FIX_DONE'].includes(task.stage)) {
    return { error: 'A fix can be requested after the Tasker marks the job complete', code: 409 };
  }
  if (task.fixUsed) return { error: 'The free fix for this job has already been used', code: 409 };
  const item = String(what || '').trim();
  if (!item) return { error: 'Say what needs fixing', code: 400 };
  task.fixUsed = true;
  task.fixes = task.fixes || [];
  task.fixes.push({ what: item.slice(0, 200), text: String(text || '').slice(0, 1000), raised: iso() });
  task.stage = 'FIX_REQUESTED';
  syncLegacy(task);
  task.updatedAt = iso();
  const tasker = acceptedTasker(task);
  await notifyUser(tasker, {
    kind: 'booking',
    title: 'Fix requested',
    body: `${user.name} asked for a fix on "${task.title || 'the task'}": ${item}.`,
    taskId: task.id,
  });
  schedulePersist();
  return { task: publicTask(task, user) };
}

export async function openDispute(taskId, user, { reason, text } = {}) {
  const gate = requireUser(user);
  if (gate) return gate;
  const task = findTask(taskId);
  if (!task) return { error: 'Task not found', code: 404 };
  if (!isParty(task, user)) return { error: 'Only the requester or the booked Tasker can report a problem', code: 403 };
  const allowed = ['TASK_STARTED', 'TASKER_COMPLETED', 'FIX_REQUESTED', 'FIX_DONE', 'UPCOMING'];
  if (!allowed.includes(task.stage)) return { error: 'A problem cannot be reported at this stage', code: 409 };
  const why = String(reason || '').trim();
  if (!why) return { error: 'Choose what happened', code: 400 };
  task.dispute = { reason: why.slice(0, 200), text: String(text || '').slice(0, 2000), status: 'OPEN', openedBy: user.id, at: iso() };
  task.stage = 'DISPUTED';
  if (task.payment) task.payment.status = 'DISPUTED';
  task.paymentStatus = 'DISPUTED';
  syncLegacy(task);
  task.updatedAt = iso();
  const other = isRequester(task, user) ? acceptedTasker(task) : findUser(task.requesterId);
  await notifyUser(other, {
    kind: 'payment',
    title: 'Problem reported',
    body: `Payment is on hold for "${task.title || 'a task'}" while this is reviewed.`,
    taskId: task.id,
  });
  schedulePersist();
  return { task: publicTask(task, user) };
}

export async function applyRefund(taskId, user, body = {}, now = new Date()) {
  const gate = requireUser(user);
  if (gate) return gate;
  const task = findTask(taskId);
  if (!task) return { error: 'Task not found', code: 404 };
  if (!isRequester(task, user)) return { error: 'Only the requester can record a refund on this task', code: 403 };

  if (task.stage === 'DISPUTED' && body.outcome) {
    const outcome = body.outcome;
    const gross = task.payment?.gross || 0;
    if (!task.payment) return { error: 'There is no payment to refund', code: 409 };
    if (outcome === 'refund') {
      fullRefund(task);
      task.stage = 'RESOLVED';
    } else if (outcome === 'partial') {
      const half = Math.round(gross * 50) / 100;
      const fee = Math.round(half * FEE_PCT) / 100;
      task.payment.partial = {
        gross: half,
        fee,
        tasker: Math.round((half - fee) * 100) / 100,
        refund: Math.round((gross - half) * 100) / 100,
      };
      task.payment.status = 'PART_RELEASE';
      task.paymentStatus = 'PART_RELEASE';
      task.stage = 'RESOLVED';
    } else if (outcome === 'release') {
      task.payment.status = 'RELEASED';
      task.paymentStatus = 'RELEASED';
      task.stage = 'COMPLETED';
    } else {
      return { error: 'Unknown refund outcome', code: 400 };
    }
    if (task.dispute) task.dispute.status = 'RESOLVED';
    syncLegacy(task);
    task.updatedAt = iso();
    const tasker = acceptedTasker(task);
    await notifyUser(tasker, {
      kind: 'payment',
      title: 'Payment decision',
      body: `A decision was recorded on "${task.title || 'the task'}".`,
      taskId: task.id,
    });
    await notifyUser(user, {
      kind: 'payment',
      title: 'Payment decision',
      body: `The payment update for "${task.title || 'your task'}" is recorded.`,
      taskId: task.id,
    });
    schedulePersist();
    return { task: publicTask(task, user) };
  }

  if (task.stage === 'NO_SHOW') {
    const money = fullRefund(task);
    schedulePersist();
    return { task: publicTask(task, user), refund: money };
  }
  if (task.stage === 'CANCELLED') {
    return { task: publicTask(task, user), refund: { refund: task.payment?.status === 'REFUNDED' ? task.payment.gross : 0 } };
  }
  if (['UPCOMING', 'ACCEPTED', 'PAYMENT_CONFIRMED'].includes(task.stage)) {
    const money = applyPolicyRefund(task, now);
    task.stage = 'CANCELLED';
    syncLegacy(task);
    task.updatedAt = iso();
    schedulePersist();
    return { task: publicTask(task, user), refund: money };
  }
  return { error: 'A refund cannot be applied at this stage', code: 409 };
}

export async function addReview(taskId, user, { stars, text, tags } = {}) {
  const gate = requireUser(user);
  if (gate) return gate;
  const task = findTask(taskId);
  if (!task) return { error: 'Task not found', code: 404 };
  if (!isParty(task, user)) return { error: 'Only the requester or the Tasker can review this job', code: 403 };
  if (!['PAYMENT_RELEASED', 'COMPLETED', 'RESOLVED', 'REQUESTER_CONFIRMED'].includes(task.stage)) {
    return { error: 'You can review once the job has been paid', code: 409 };
  }
  if (store.reviews.some((r) => r.taskId === task.id && r.fromUserId === user.id)) {
    return { error: 'You already reviewed this job', code: 409 };
  }
  const rating = Number(stars);
  if (!Number.isInteger(rating) || rating < 1 || rating > 5) return { error: 'Choose a star rating from 1 to 5', code: 400 };
  const otherId = isRequester(task, user) ? acceptedBid(task)?.taskerId : task.requesterId;
  const review = {
    id: store.counters.reviewId++,
    taskId: task.id,
    fromUserId: user.id,
    toUserId: otherId || null,
    stars: rating,
    text: String(text || '').slice(0, 1000),
    tags: Array.isArray(tags) ? tags.map(String).slice(0, 8) : [],
    at: iso(),
  };
  store.reviews.push(review);
  if (otherId) {
    const about = store.reviews.filter((r) => r.toUserId === otherId);
    const target = findUserAny(otherId);
    if (target && about.length) {
      target.rating = Math.round((about.reduce((s, r) => s + r.stars, 0) / about.length) * 10) / 10;
      target.ratingCount = about.length;
    }
  }
  schedulePersist();
  return { review, task: publicTask(task, user) };
}

export function markStarted(taskId, user) {
  const gate = requireUser(user);
  if (gate) return gate;
  const task = findTask(taskId);
  if (!task) return { error: 'Task not found', code: 404 };
  if (!isParty(task, user)) return { error: 'Only the requester or the booked Tasker can start this task', code: 403 };
  if (!['UPCOMING', 'ACCEPTED', 'PAYMENT_CONFIRMED'].includes(task.stage)) {
    return { error: 'Task must be booked before it can start', code: 409 };
  }
  task.stage = 'TASK_STARTED';
  syncLegacy(task);
  task.updatedAt = iso();
  schedulePersist();
  return { task: publicTask(task, user) };
}

export function markCompleted(taskId, user, { photoCount } = {}) {
  const gate = requireUser(user);
  if (gate) return gate;
  const task = findTask(taskId);
  if (!task) return { error: 'Task not found', code: 404 };
  if (!isParty(task, user)) return { error: 'Only the requester or the booked Tasker can complete this task', code: 403 };
  if (task.stage !== 'TASK_STARTED') return { error: 'Task must be started before it can be completed', code: 409 };
  const photos = Number(photoCount ?? task.photoCount ?? 0);
  if (!(photos > 0)) {
    return { error: 'Add a photo showing the work is done before marking it complete', code: 400 };
  }
  if (photos > 0) task.photoCount = photos;
  task.stage = 'TASKER_COMPLETED';
  syncLegacy(task);
  task.updatedAt = iso();
  schedulePersist();
  return { task: publicTask(task, user) };
}

export async function approvePayment(taskId, user) {
  const gate = requireUser(user);
  if (gate) return gate;
  const task = findTask(taskId);
  if (!task) return { error: 'Task not found', code: 404 };
  if (!isRequester(task, user)) return { error: 'Only the requester can release payment', code: 403 };
  if (!['TASKER_COMPLETED', 'FIX_DONE', 'REQUESTER_CONFIRMED'].includes(task.stage)) {
    return { error: 'Payment can be released after the job is marked complete', code: 409 };
  }
  if (!task.payment) return { error: 'There is no payment to release', code: 409 };
  if (task.payment.status === 'RELEASED') return { error: 'Payment was already released', code: 409 };
  if (task.payment.status === 'DISPUTED' || task.stage === 'DISPUTED') {
    return { error: 'Payment is on hold until the problem is resolved', code: 409 };
  }
  if (task.payment.status !== 'AUTHORISED') return { error: 'Payment cannot be released in its current state', code: 409 };
  task.payment.status = 'RELEASED';
  task.paymentStatus = 'RELEASED';
  task.stage = 'COMPLETED';
  syncLegacy(task);
  task.updatedAt = iso();
  const tasker = acceptedTasker(task);
  const name = acceptedBid(task)?.taskerName || 'your Tasker';
  await notifyUser(tasker, {
    kind: 'payment',
    title: 'Payment released',
    body: `Payment for "${task.title || 'the task'}" has been released.`,
    taskId: task.id,
  });
  await notifyUser(user, {
    kind: 'payment',
    title: 'Payment released',
    body: `Payment was released to ${name}. You paid no booking fee.`,
    taskId: task.id,
  });
  schedulePersist();
  return { task: publicTask(task, user) };
}

export function markFixed(taskId, user, { photoCount } = {}) {
  const gate = requireUser(user);
  if (gate) return gate;
  const task = findTask(taskId);
  if (!task) return { error: 'Task not found', code: 404 };
  if (!isParty(task, user)) return { error: 'You cannot update this fix', code: 403 };
  if (task.stage !== 'FIX_REQUESTED') return { error: 'There is no open fix request', code: 409 };
  if (!(Number(photoCount) > 0)) return { error: 'Add a photo of the fix first', code: 400 };
  task.stage = 'FIX_DONE';
  syncLegacy(task);
  task.updatedAt = iso();
  schedulePersist();
  return { task: publicTask(task, user) };
}

export function canMessage(task, user) {
  if (!user || !task) return false;
  if (isRequester(task, user)) return true;
  if (isAcceptedTasker(task, user)) return true;
  if (['POSTED', 'OFFERS_RECEIVED'].includes(task.stage)) return true;
  if (store.bids.some((b) => b.taskId === task.id && b.taskerId === user.id)) return true;
  return false;
}

export async function postMessage(taskId, user, { text } = {}) {
  const gate = requireUser(user);
  if (gate) return gate;
  const task = findTask(taskId);
  if (!task) return { error: 'Task not found', code: 404 };
  if (!canMessage(task, user)) return { error: 'You cannot message on this task', code: 403 };
  const body = String(text || '').trim();
  if (!body) return { error: 'Write a message first', code: 400 };
  if (body.length > 2000) return { error: 'That message is too long', code: 400 };
  const warning = CONTACT_OR_CASH.test(body);
  const msg = {
    id: store.counters.messageId++,
    taskId: task.id,
    fromUserId: user.id,
    fromName: user.name,
    text: body,
    at: iso(),
    warning,
  };
  store.messages.push(msg);
  const targets = new Map();
  const remember = (person) => { if (person && person.id !== user.id) targets.set(person.id, person); };
  remember(findUser(task.requesterId));
  remember(acceptedTasker(task));
  for (const bid of bidsForTask(task.id)) {
    if (bid.taskerId && (bid.status === 'pending' || bid.status === 'accepted')) remember(findUser(bid.taskerId));
  }
  for (const earlier of store.messages) {
    if (earlier.taskId === task.id) remember(findUser(earlier.fromUserId));
  }
  for (const person of targets.values()) {
    await notifyUser(person, {
      kind: 'message',
      title: 'New message',
      body: `${user.name} wrote about "${task.title || 'a task'}".`,
      taskId: task.id,
    });
  }
  schedulePersist();
  return { message: msg, warning, warningText: warning ? CONTACT_WARNING : null };
}

export function listMessages(taskId, user) {
  const gate = requireUser(user);
  if (gate) return gate;
  const task = findTask(taskId);
  if (!task) return { error: 'Task not found', code: 404 };
  if (!canMessage(task, user)) return { error: 'You cannot read these messages', code: 403 };
  let messages = store.messages.filter((m) => m.taskId === task.id);
  if (!isRequester(task, user) && !isAcceptedTasker(task, user)) {
    messages = messages.filter((m) => m.fromUserId === user.id || m.fromUserId === task.requesterId);
  }
  return { messages: messages.map((m) => ({ ...m })), warningText: CONTACT_WARNING };
}

export function saveBundle(taskId, user, bundle) {
  const gate = requireUser(user);
  if (gate) return gate;
  const task = findTask(taskId);
  if (!task) return { error: 'Task not found', code: 404 };
  if (!isParty(task, user)) return { error: 'You cannot update this task', code: 403 };
  const raw = JSON.stringify(bundle ?? null);
  if (raw.length > 1_500_000) return { error: 'Task details are too large to save', code: 413 };
  task.bundle = bundle ?? null;
  task.updatedAt = iso();
  schedulePersist();
  return { ok: true };
}

export function listSavedSearches(user) {
  return store.savedSearches.filter((s) => s.userId === user.id).map((s) => ({ ...s }));
}

export function saveSearch(user, body = {}) {
  const gate = requireUser(user);
  if (gate) return gate;
  const row = {
    id: store.counters.searchId++,
    userId: user.id,
    q: String(body.q || '').slice(0, 120),
    cat: retireCat(String(body.cat || 'all')).slice(0, 40) || 'all',
    km: savedDistanceKm(body.km),
    sort: String(body.sort || 'closest'),
    maxPrice: body.maxPrice != null && body.maxPrice !== '' ? Number(body.maxPrice) : null,
    alert: body.alert !== false,
    lat: user.lat,
    lng: user.lng,
    createdAt: iso(),
  };
  store.savedSearches.push(row);
  schedulePersist();
  return { search: { ...row }, savedSearches: listSavedSearches(user) };
}

export function updateSearch(id, user, patch = {}) {
  const gate = requireUser(user);
  if (gate) return gate;
  const row = store.savedSearches.find((s) => s.id === Number(id) && s.userId === user.id);
  if (!row) return { error: 'Saved search not found', code: 404 };
  if (patch.alert != null) row.alert = !!patch.alert;
  if (patch.q != null) row.q = String(patch.q).slice(0, 120);
  schedulePersist();
  return { search: { ...row }, savedSearches: listSavedSearches(user) };
}

export function deleteSearch(id, user) {
  const gate = requireUser(user);
  if (gate) return gate;
  const before = store.savedSearches.length;
  store.savedSearches = store.savedSearches.filter((s) => !(s.id === Number(id) && s.userId === user.id));
  if (store.savedSearches.length === before) return { error: 'Saved search not found', code: 404 };
  schedulePersist();
  return { savedSearches: listSavedSearches(user) };
}

function ownerRecord(rec) {
  return {
    id: rec.id,
    taskId: rec.taskId || null,
    title: rec.title,
    cat: rec.cat,
    taskerName: rec.taskerName,
    date: rec.date,
    paid: rec.paid,
    suburb: rec.suburb || '',
    property: rec.propPrivate || '',
    check: rec.check || '',
    note: rec.note || '',
    photoCount: rec.photoCount || 0,
  };
}

export function toPublicRecord(rec) {
  return {
    id: rec.id,
    title: rec.title,
    cat: rec.cat,
    taskerName: rec.taskerName,
    date: rec.date,
    paid: rec.paid,
    suburb: rec.suburb || '',
    check: rec.check || '',
    note: rec.note || '',
    photoCount: rec.photoCount || 0,
  };
}

export function saveRecords(user, rows) {
  const gate = requireUser(user);
  if (gate) return gate;
  const ids = [];
  for (const row of (rows || []).slice(0, 200)) {
    const title = String(row.title || '').slice(0, 180);
    const date = String(row.date || '').slice(0, 40);
    const paid = Number(row.paid) || 0;
    if (!title) continue;
    let existing = store.records.find((r) => r.userId === user.id && r.title === title && r.date === date && r.paid === paid);
    const next = {
      title,
      cat: retireCat(String(row.cat || '')).slice(0, 40),
      taskerName: String(row.taskerName || row.tasker || '').slice(0, 80),
      date,
      paid,
      suburb: String(row.suburb || '').slice(0, 80),
      propPrivate: String(row.propPrivate || row.property || '').slice(0, 200),
      check: String(row.check || '').slice(0, 40),
      note: String(row.note || '').slice(0, 300),
      photoCount: Math.min(20, Number(row.photoCount) || 0),
      taskId: row.taskId || null,
    };
    if (!existing) {
      existing = { id: store.counters.recordId++, userId: user.id, createdAt: iso(), ...next };
      store.records.push(existing);
    } else {
      Object.assign(existing, next);
    }
    ids.push(existing.id);
  }
  schedulePersist();
  return { ids, records: store.records.filter((r) => r.userId === user.id).map(ownerRecord) };
}

export function createShare(user, { recordIds } = {}) {
  const gate = requireUser(user);
  if (gate) return gate;
  const mine = store.records.filter((r) => r.userId === user.id);
  let chosen = mine;
  if (Array.isArray(recordIds) && recordIds.length) {
    const want = new Set(recordIds.map(Number));
    chosen = mine.filter((r) => want.has(r.id));
  }
  if (!chosen.length) return { error: 'There are no job records to share yet', code: 400 };
  const token = newSessionToken().slice(0, 32);
  store.shares.push({ token, userId: user.id, recordIds: chosen.map((r) => r.id), createdAt: iso() });
  schedulePersist();
  return { token, path: `/?share=${token}` };
}

export function getPublicShare(token) {
  const share = store.shares.find((s) => s.token === token);
  if (!share) return { error: 'This share link is not valid', code: 404 };
  const ids = new Set(share.recordIds || []);
  const records = store.records.filter((r) => r.userId === share.userId && ids.has(r.id)).map(toPublicRecord);
  return { sharedAt: share.createdAt, records, privateAddress: false };
}

function csvCell(value) {
  const s = value == null ? '' : String(value);
  if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

export function recordsToCsv(records, { includeProperty }) {
  const headers = includeProperty
    ? ['date', 'title', 'category', 'tasker', 'amount', 'suburb', 'property', 'proof_photos']
    : ['date', 'title', 'category', 'tasker', 'amount', 'suburb', 'proof_photos'];
  const lines = [headers.join(',')];
  for (const r of records) {
    const cells = [r.date, r.title, r.cat, r.taskerName, r.paid, r.suburb || ''];
    if (includeProperty) cells.push(r.property || r.propPrivate || '');
    cells.push(r.photoCount || 0);
    lines.push(cells.map(csvCell).join(','));
  }
  return lines.join('\n') + '\n';
}

export function csvForUser(user) {
  const records = store.records.filter((r) => r.userId === user.id).map(ownerRecord);
  return recordsToCsv(records, { includeProperty: true });
}

export function csvForShare(token) {
  const share = getPublicShare(token);
  if (share.error) return share;
  return { csv: recordsToCsv(share.records, { includeProperty: false }) };
}

export function listNotifications(user) {
  return store.notifications.filter((n) => n.userId === user.id).slice().reverse().map((n) => ({ ...n }));
}

export function markNotificationsRead(user) {
  for (const n of store.notifications) if (n.userId === user.id) n.read = true;
  schedulePersist();
  return { notifications: listNotifications(user) };
}

export async function sweepJobDays(now = new Date()) {
  let sent = 0;
  for (const task of store.tasks) {
    if (task.jobDayNotified) continue;
    if (!['UPCOMING', 'ACCEPTED', 'PAYMENT_CONFIRMED'].includes(task.stage)) continue;
    if (!task.startAt) continue;
    const start = new Date(task.startAt);
    if (Number.isNaN(start.getTime())) continue;
    const same = start.getFullYear() === now.getFullYear() && start.getMonth() === now.getMonth() && start.getDate() === now.getDate();
    if (!same) continue;
    task.jobDayNotified = true;
    const body = `Today is the day for "${task.title || 'your task'}".`;
    const requester = findUser(task.requesterId);
    const tasker = acceptedTasker(task);
    if (await notifyUser(requester, { kind: 'jobday', title: 'Job day', body, taskId: task.id })) sent += 1;
    if (await notifyUser(tasker, { kind: 'jobday', title: 'Job day', body, taskId: task.id })) sent += 1;
  }
  schedulePersist();
  return { sent };
}

export function workspace(user) {
  const tasks = store.tasks.filter((t) => t.requesterId === user.id).map((t) => publicTask(t, user));
  const bids = store.bids.filter((b) => b.taskerId === user.id).map((b) => ({ ...publicBid(b), task: briefTask(findTask(b.taskId)) }));
  const taskIds = new Set([
    ...tasks.map((t) => t.id),
    ...bids.map((b) => b.taskId),
  ]);
  const messages = store.messages.filter((m) => taskIds.has(m.taskId) || m.fromUserId === user.id).map((m) => ({ ...m }));
  return {
    user: publicUser(user),
    tasks,
    bids,
    notifications: listNotifications(user),
    savedSearches: listSavedSearches(user),
    records: store.records.filter((r) => r.userId === user.id).map(ownerRecord),
    messages,
  };
}

export function listPublishedTasks(viewer) {
  return store.tasks
    .filter((t) => t.published && !['Draft', 'CANCELLED', 'UNDER_REVIEW'].includes(t.stage))
    .map((t) => publicTask(t, viewer));
}

export function getTaskListing(viewer) {
  if (!viewer) return [];
  return store.tasks.filter((t) => t.requesterId === viewer.id).map((t) => publicTask(t, viewer));
}

export function getTaskById(id, viewer) {
  const task = findTask(id);
  if (!task) return null;
  if (!task.published && !(viewer && viewer.id === task.requesterId)) return null;
  return publicTask(task, viewer);
}

export function listUsers() {
  return store.users.filter((u) => !u.deletedAt).map((u) => ({ id: u.id, name: u.name, suburb: u.suburb }));
}

export function getStoreSnapshot(viewer) {
  return {
    tasks: getTaskListing(viewer),
    bids: store.bids.filter((b) => viewer && (b.taskerId === viewer.id || findTask(b.taskId)?.requesterId === viewer.id)).map(publicBid),
  };
}

function migrateLegacyTasksFile() {
  if (!fs.existsSync(legacyFile())) return;
  try {
    const raw = JSON.parse(fs.readFileSync(legacyFile(), 'utf8'));
    if (!Array.isArray(raw.tasks) || store.tasks.length) return;
    for (const row of raw.tasks) {
      const task = {
        id: row.id,
        requesterId: 0,
        requesterName: 'Alex',
        text: row.text || '',
        title: row.title || '',
        cat: row.cat || 'other',
        status: row.status === 'Assigned' ? 'Assigned' : row.published ? 'Open' : 'Draft',
        stage: row.status === 'Assigned' ? 'UPCOMING' : row.published ? 'POSTED' : 'Draft',
        published: !!row.published,
        acceptedBidId: null,
        paymentStatus: row.status === 'Assigned' ? 'AUTHORISED' : 'none',
        payment: null,
        address: '',
        suburb: 'Melbourne',
        budgetLabel: 'Open to offers',
        priceNum: null,
        photoCount: 0,
        fixes: [],
        dispute: null,
        fixUsed: false,
        bundle: null,
        jobDayNotified: false,
        propPrivate: '',
        createdAt: row.updatedAt || iso(),
        updatedAt: row.updatedAt || iso(),
      };
      const point = pointFor(task.suburb);
      task.lat = point ? point.lat : null;
      task.lng = point ? point.lng : null;
      task.cityId = point ? point.cityId : 'melbourne';
      store.tasks.push(task);
      if (row.bid) {
        const bid = {
          id: store.counters.bidId++,
          taskId: task.id,
          taskerId: null,
          taskerName: row.bid.taskerName || 'You',
          fee: row.bid.fee,
          message: '',
          status: 'accepted',
          source: 'demo',
          at: row.bid.at || iso(),
          updatedAt: row.bid.at || iso(),
        };
        store.bids.push(bid);
        task.acceptedBidId = bid.id;
        task.payment = splitPay(bid.fee);
      }
      if (row.id >= store.counters.taskId) store.counters.taskId = row.id + 1;
      syncLegacy(task);
    }
    persistNow();
  } catch {
    /* ignore a bad legacy file */
  }
}

loadStore();
