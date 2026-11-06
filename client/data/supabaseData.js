/**
 * Supabase data layer. Screens still call /api. This file answers those calls
 * with Auth, Postgres and Storage. Phone numbers and street addresses are not
 * read from the public job row. They come back only from job_contact, and only
 * for the customer and the booked Tasker while the job is in the right stage.
 */
import {
  CASH_PATTERN,
  CHAT_WARNING,
  CONTACT_WARNING,
  HIDDEN,
  RULE_REMINDER,
  guardMessage,
  shortName,
} from '../../shared/chatGuard.js';
import { highRiskAnswer, prohibitedReason } from '../../server/safety.js';
import { registeredWorkReason } from '../../shared/registeredWork.js';
import {
  LAUNCH_CENTER,
  comingSoonMessage,
  launchRadiusKm,
  launchStatus,
  resolveSuburb,
  searchSuburbs,
} from '../../shared/places.js';
import { withAuth } from './withAuth.js';

const FEE_PCT = 15;

const NAME_OPEN = new Set([
  'ACCEPTED', 'PAYMENT_CONFIRMED', 'UPCOMING', 'ON_THE_WAY', 'TASK_STARTED', 'TASKER_COMPLETED',
  'FIX_REQUESTED', 'FIX_DONE', 'DISPUTED', 'REQUESTER_CONFIRMED', 'PAYMENT_RELEASED',
  'COMPLETED', 'RESOLVED',
]);
const PHONE_OPEN = new Set([
  'ACCEPTED', 'PAYMENT_CONFIRMED', 'UPCOMING', 'ON_THE_WAY', 'TASK_STARTED',
  'FIX_REQUESTED', 'FIX_DONE', 'DISPUTED',
]);

function httpError(status, message) {
  const err = new Error(message);
  err.status = status;
  return err;
}

function fail(status, error) {
  return { status, json: { error } };
}

function ok(json) {
  return { status: 200, json };
}

function dbError(error) {
  const msg = (error && error.message) || 'The database could not complete that.';
  if (/relation|schema cache|does not exist|bucket/i.test(msg)) {
    return 'The database is not set up yet. Follow SETUP-LIVE.md and run the SQL.';
  }
  return msg;
}

function friendlyAuth(message) {
  const text = String(message || 'Sign-in did not work.');
  if (/invalid login/i.test(text)) return 'That email or password is not right.';
  if (/already registered|already exists/i.test(text)) return 'An account with that email already exists';
  if (/phone/i.test(text) && /provider|disabled|not enabled|unsupported/i.test(text)) {
    return 'Phone sign-in is not switched on yet. Use email for now, or turn on the phone provider in Supabase.';
  }
  return text;
}

function emailOk(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email || '').trim());
}

function numId(id) {
  const n = Number(id);
  return Number.isSafeInteger(n) ? n : id;
}

function asObject(data) {
  if (Array.isArray(data)) return data[0] || null;
  return data || null;
}

function nowIso() {
  return new Date().toISOString();
}

/** 15% of the whole amount the Tasker is paid, including materials. */
function splitPay(gross) {
  const amount = Math.round(Number(gross) * 100) / 100;
  const fee = Math.round(amount * FEE_PCT) / 100;
  const tasker = Math.round((amount - fee) * 100) / 100;
  return { gross: amount, fee, tasker, status: 'AUTHORISED', callout: 0, partial: null, demo: false };
}

function same(a, b) {
  return a != null && b != null && String(a) === String(b);
}

function isParty(job, offers, viewerId) {
  if (!viewerId || !job) return false;
  if (same(job.requester_id, viewerId)) return true;
  return (offers || []).some((o) => o.status === 'accepted' && same(o.tasker_id, viewerId));
}

function shownName(full, viewerId, ownerId, open) {
  const name = String(full || '').trim();
  if (!name) return name;
  if (same(viewerId, ownerId)) return name;
  if (open) return name;
  return shortName(name);
}

function legacyStatus(stage) {
  if (stage === 'Draft' || stage === 'UNDER_REVIEW') return 'Draft';
  if (stage === 'POSTED' || stage === 'OFFERS_RECEIVED') return 'Open';
  if (stage === 'ACCEPTED' || stage === 'PAYMENT_CONFIRMED' || stage === 'UPCOMING') return 'Assigned';
  if (stage === 'ON_THE_WAY') return 'OnTheWay';
  if (stage === 'TASK_STARTED' || stage === 'FIX_REQUESTED' || stage === 'DISPUTED') return 'Started';
  if (stage === 'TASKER_COMPLETED' || stage === 'FIX_DONE') return 'Completed';
  if (stage === 'CANCELLED') return 'CANCELLED';
  if (stage === 'NO_SHOW') return 'NO_SHOW';
  return 'PaymentReleased';
}

function emailRedirect() {
  if (typeof location === 'undefined') return undefined;
  const base = (import.meta.env && import.meta.env.BASE_URL) || '/';
  return location.origin + (base.endsWith('/') ? base : `${base}/`);
}

async function first(builder) {
  const result = await builder.maybeSingle();
  if (result.error) throw httpError(400, dbError(result.error));
  return result.data || null;
}

async function rows(builder) {
  const result = await builder;
  if (result.error) throw httpError(400, dbError(result.error));
  return result.data || [];
}

async function changed(builder) {
  const result = await builder;
  if (result.error) throw httpError(400, dbError(result.error));
  return result.data;
}

async function sessionUser(supabase) {
  const { data, error } = await supabase.auth.getSession();
  if (error) throw httpError(401, friendlyAuth(error.message));
  return data && data.session ? data.session.user : null;
}

function publicProfile(profile, phone) {
  const row = profile || {};
  const settings = row.settings || {};
  const place = resolveSuburb(row.suburb || '');
  const zone = place ? launchStatus(place) : { open: false, km: null, reason: 'unknown' };
  return {
    id: row.id,
    name: row.name || '',
    email: row.email || '',
    phone: phone || '',
    suburb: row.suburb || '',
    lat: row.lat ?? (place ? place.lat : null),
    lng: row.lng ?? (place ? place.lng : null),
    cityId: row.city_id || (place ? place.cityId : ''),
    role: row.role || '',
    demoMode: !!settings.demoMode,
    safetyGuide: !!row.safety_guide,
    launch: {
      open: row.suburb ? !!zone.open : false,
      radiusKm: launchRadiusKm(),
      center: LAUNCH_CENTER,
      kmFromCentre: zone.km,
    },
    bio: row.bio || '',
    areas: row.areas || '',
    vehicle: row.vehicle || '',
    langs: ['English'],
    notif: settings.notif || {},
    avail: settings.avail || {},
    createdAt: row.created_at || null,
    rating: null,
    ratingCount: 0,
    reliability: {},
  };
}

async function ensureProfile(supabase, authUser) {
  let profile = await first(supabase.from('profiles').select('*').eq('id', authUser.id));
  if (!profile) {
    await changed(supabase.from('profiles').upsert({
      id: authUser.id,
      email: authUser.email || '',
      name: (authUser.user_metadata && authUser.user_metadata.name) || '',
    }, { onConflict: 'id' }));
    profile = await first(supabase.from('profiles').select('*').eq('id', authUser.id));
  }
  return profile || { id: authUser.id, email: authUser.email || '', name: '' };
}

async function loadPublicUser(supabase, authUser) {
  const profile = await ensureProfile(supabase, authUser);
  const phoneRow = await first(supabase.from('profile_phones').select('*').eq('user_id', authUser.id));
  return publicProfile(profile, phoneRow ? phoneRow.phone : '');
}

async function signAll(supabase, paths) {
  const out = [];
  for (const path of paths || []) {
    if (!path) continue;
    if (String(path).startsWith('http') || String(path).startsWith('data:')) {
      out.push(path);
      continue;
    }
    if (!supabase.storage) continue;
    const signed = await supabase.storage.from('job-photos').createSignedUrl(path, 60 * 60 * 24 * 7);
    if (signed && !signed.error && signed.data && signed.data.signedUrl) out.push(signed.data.signedUrl);
  }
  return out;
}

async function presentJob(supabase, job, viewerId) {
  const offers = await rows(supabase.from('offers').select('*').eq('job_id', job.id));
  const requester = await first(supabase.from('profiles').select('*').eq('id', job.requester_id));
  const party = isParty(job, offers, viewerId);
  const namesOpen = NAME_OPEN.has(job.stage) && party;
  const phonesOpen = PHONE_OPEN.has(job.stage) && party;
  let contact = null;
  if (party) {
    const rpc = await supabase.rpc('job_contact', { p_job_id: numId(job.id) });
    if (rpc && !rpc.error) contact = asObject(rpc.data);
  }
  const accepted = offers.find((o) => o.status === 'accepted')
    || offers.find((o) => same(o.id, job.accepted_offer_id));
  const visible = offers.filter((o) => same(job.requester_id, viewerId) || same(o.tasker_id, viewerId));
  let bidCount = offers.filter((o) => o.status === 'pending').length;
  const counted = await supabase.rpc('offer_count', { p_job_id: numId(job.id) });
  if (counted && !counted.error && counted.data != null && counted.data !== '') bidCount = Number(counted.data);

  const task = {
    id: numId(job.id),
    requesterId: job.requester_id,
    requesterName: shownName(requester && requester.name, viewerId, job.requester_id, namesOpen),
    text: job.text || '',
    title: job.title || '',
    cat: job.cat || 'other',
    status: job.status || legacyStatus(job.stage),
    stage: job.stage,
    published: !!job.published,
    acceptedBidId: job.accepted_offer_id ? numId(job.accepted_offer_id) : null,
    paymentStatus: job.payment_status || 'none',
    suburb: job.suburb || '',
    lat: job.lat ?? null,
    lng: job.lng ?? null,
    date: null,
    startAt: job.start_at || null,
    startMin: job.start_min ?? null,
    durationMin: job.duration_min ?? null,
    budgetLabel: job.budget_label || 'Open to offers',
    priceNum: job.price_num ?? null,
    photoCount: job.photo_count || 0,
    beforeCount: (job.before_paths || []).length,
    afterCount: (job.after_paths || []).length,
    repeatEvery: job.repeat_every || null,
    repeatOf: job.repeat_of ? numId(job.repeat_of) : null,
    cancelledBy: job.cancelled_by || null,
    assignedAt: job.assigned_at || null,
    onTheWayAt: job.on_the_way_at || null,
    startedAt: job.started_at || null,
    doneAt: job.done_at || null,
    bidCount: Number.isFinite(bidCount) ? bidCount : 0,
    updatedAt: job.updated_at || null,
    createdAt: job.created_at || null,
    bids: visible.map((o) => ({
      id: numId(o.id),
      taskId: numId(job.id),
      taskerId: o.tasker_id,
      taskerName: shownName(o.tasker_name, viewerId, o.tasker_id, namesOpen),
      fee: Number(o.fee),
      message: o.message || '',
      status: o.status,
    })),
  };
  if (accepted) {
    task.bid = {
      id: numId(accepted.id),
      taskerName: shownName(accepted.tasker_name, viewerId, accepted.tasker_id, namesOpen),
      fee: Number(accepted.fee),
      at: accepted.created_at || null,
    };
  }
  if (!party) return task;
  if (contact && contact.address) task.address = contact.address;
  if (contact && contact.prop_private) task.propPrivate = contact.prop_private;
  task.payment = job.payment || null;
  task.fixes = job.fixes || [];
  task.dispute = job.dispute || null;
  task.fixUsed = !!job.fix_used;
  task.bundle = job.bundle || null;
  task.notes = job.notes || [];
  task.special = job.special || [];
  task.milestones = job.milestones || [];
  if (phonesOpen && contact) {
    task.phones = {
      requester: contact.requester_phone || '',
      tasker: contact.tasker_phone || '',
    };
  }
  task.beforePhotos = await signAll(supabase, job.before_paths);
  task.afterPhotos = await signAll(supabase, job.after_paths);
  const reviews = await rows(supabase.from('reviews').select('*').eq('job_id', job.id));
  task.reviews = [];
  for (const review of reviews) {
    const who = await first(supabase.from('profiles').select('*').eq('id', review.from_user_id));
    task.reviews.push({
      stars: review.stars,
      text: review.text || '',
      name: shownName(who && who.name, viewerId, review.from_user_id, namesOpen),
      role: same(review.from_user_id, job.requester_id) ? 'customer' : 'tasker',
    });
  }
  return task;
}

async function mustJob(supabase, id) {
  const job = await first(supabase.from('jobs').select('*').eq('id', numId(id)));
  if (!job) throw httpError(404, 'Task not found');
  return job;
}

async function jobOffers(supabase, jobId) {
  return rows(supabase.from('offers').select('*').eq('job_id', jobId));
}

function canMessage(job, offers, userId) {
  if (!job || !userId) return false;
  if (same(job.requester_id, userId)) return true;
  if ((offers || []).some((o) => o.status === 'accepted' && same(o.tasker_id, userId))) return true;
  if (['POSTED', 'OFFERS_RECEIVED'].includes(job.stage)) return true;
  return (offers || []).some((o) => same(o.tasker_id, userId));
}

async function tell(supabase, userId, kind, title, body, jobId) {
  if (!userId) return;
  try {
    await supabase.rpc('notify_user', {
      p_user: userId,
      p_kind: kind,
      p_title: title,
      p_body: body,
      p_job: jobId == null ? null : numId(jobId),
    });
  } catch {
    /* A missing notify function should not undo the booking. */
  }
}

async function saveJob(supabase, job, viewerId, patch) {
  const next = { ...patch, updated_at: nowIso() };
  if (same(job.requester_id, viewerId)) {
    await changed(supabase.from('jobs').update(next).eq('id', job.id));
    return;
  }
  const rpc = await supabase.rpc('set_job_stage', {
    p_job_id: numId(job.id),
    p_stage: patch.stage || null,
    p_patch: next,
  });
  if (rpc && rpc.error) throw httpError(400, dbError(rpc.error));
}

async function presentMessage(supabase, message, job, offers, viewerId) {
  const author = await first(supabase.from('profiles').select('*').eq('id', message.from_user_id));
  const namesOpen = NAME_OPEN.has(job.stage) && isParty(job, offers, viewerId);
  const mine = same(message.from_user_id, viewerId);
  return {
    id: numId(message.id),
    taskId: numId(job.id),
    fromUserId: message.from_user_id,
    fromName: mine ? ((author && author.name) || '') : shownName(author && author.name, viewerId, message.from_user_id, namesOpen),
    text: message.text,
    warning: !!message.warning,
    at: message.created_at || null,
  };
}

async function reminderFor(supabase, jobId, userId) {
  const messages = await rows(supabase.from('messages').select('*').eq('job_id', jobId));
  const counts = {};
  for (const message of messages) {
    if (!message.warning || same(message.from_user_id, userId)) continue;
    counts[message.from_user_id] = (counts[message.from_user_id] || 0) + 1;
  }
  if (Object.values(counts).some((n) => n >= 2)) return true;
  const reports = await rows(supabase.from('reports').select('*').eq('job_id', jobId).eq('from_user_id', userId));
  return reports.length >= 2;
}

function dataUrlParts(dataUrl) {
  const match = String(dataUrl || '').match(/^data:([^;,]+)(;base64)?,(.*)$/);
  if (!match) return null;
  const type = match[1];
  const payload = match[3];
  let bytes;
  if (match[2]) {
    if (typeof Buffer !== 'undefined') bytes = new Uint8Array(Buffer.from(payload, 'base64'));
    else {
      const bin = atob(payload);
      bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i += 1) bytes[i] = bin.charCodeAt(i);
    }
  } else {
    bytes = new TextEncoder().encode(decodeURIComponent(payload));
  }
  if (bytes.length > 120000) return { error: 'That photo is too large' };
  return { type, bytes };
}

async function storePhotos(supabase, userId, jobId, kind, list) {
  if (!supabase.storage) throw httpError(400, 'Photo storage is not set up yet. Follow SETUP-LIVE.md.');
  const paths = [];
  for (const item of list || []) {
    if (!String(item).startsWith('data:image/')) continue;
    const parsed = dataUrlParts(item);
    if (!parsed) continue;
    if (parsed.error) throw httpError(400, parsed.error);
    const path = `${userId}/${jobId}/${kind}-${Date.now()}-${paths.length}.jpg`;
    const uploaded = await supabase.storage.from('job-photos').upload(path, parsed.bytes, { contentType: parsed.type, upsert: false });
    if (uploaded && uploaded.error) throw httpError(400, dbError(uploaded.error));
    await changed(supabase.from('job_photos').insert({
      job_id: numId(jobId),
      owner_id: userId,
      kind,
      path,
    }));
    paths.push(path);
  }
  return paths;
}

function brief(job) {
  if (!job) return null;
  return {
    id: numId(job.id),
    title: job.title || '',
    cat: job.cat || 'other',
    suburb: job.suburb || '',
    status: job.status || job.stage,
    stage: job.stage,
    date: null,
    budgetLabel: job.budget_label || '',
  };
}

async function workspace(supabase, authUser) {
  const user = await loadPublicUser(supabase, authUser);
  const own = await rows(supabase.from('jobs').select('*').eq('requester_id', authUser.id));
  const myOffers = await rows(supabase.from('offers').select('*').eq('tasker_id', authUser.id));
  const jobs = [...own];
  for (const offer of myOffers) {
    if (offer.status !== 'accepted') continue;
    if (jobs.some((job) => same(job.id, offer.job_id))) continue;
    const job = await first(supabase.from('jobs').select('*').eq('id', offer.job_id));
    if (job) jobs.push(job);
  }
  const tasks = [];
  const messages = [];
  for (const job of jobs) {
    const offers = await jobOffers(supabase, job.id);
    tasks.push(await presentJob(supabase, job, authUser.id));
    const thread = await rows(supabase.from('messages').select('*').eq('job_id', job.id));
    for (const message of thread) messages.push(await presentMessage(supabase, message, job, offers, authUser.id));
  }
  const bids = [];
  for (const offer of myOffers) {
    const job = await first(supabase.from('jobs').select('*').eq('id', offer.job_id));
    bids.push({
      id: numId(offer.id),
      taskId: numId(offer.job_id),
      taskerId: offer.tasker_id,
      taskerName: offer.tasker_name,
      fee: Number(offer.fee),
      message: offer.message || '',
      status: offer.status,
      task: brief(job),
    });
  }
  const notes = await rows(supabase.from('notifications').select('*').eq('user_id', authUser.id));
  const searches = await rows(supabase.from('saved_searches').select('*').eq('user_id', authUser.id));
  const records = await rows(supabase.from('records').select('*').eq('user_id', authUser.id));
  return {
    user,
    tasks,
    bids,
    messages,
    notifications: notes.map((n) => ({
      id: numId(n.id),
      title: n.title || '',
      body: n.body || '',
      kind: n.kind || '',
      at: n.created_at,
      read: !!n.read,
      taskId: n.job_id ? numId(n.job_id) : null,
    })),
    savedSearches: searches.map((s) => ({
      id: numId(s.id),
      q: s.q || '',
      cat: s.cat || 'all',
      km: s.km,
      sort: s.sort || 'closest',
      alert: !!s.alert,
    })),
    records: records.map((r) => ({
      id: numId(r.id),
      title: r.title || '',
      cat: r.cat || '',
      taskerName: r.tasker_name || '',
      date: r.date || '',
      paid: Number(r.paid) || 0,
      suburb: r.suburb || '',
      property: r.prop_private || '',
      check: r.check_text || '',
      note: r.note || '',
      photoCount: r.photo_count || 0,
    })),
  };
}

function requireUser(authUser) {
  if (!authUser) return fail(401, 'Sign in required');
  return null;
}

async function route(supabase, { method = 'GET', path = '', query, body } = {}) {
  const m = String(method || 'GET').toUpperCase();
  const url = path;
  const q = query || new URLSearchParams();
  const input = body || {};
  const authUser = await sessionUser(supabase);

  if (url === '/api/health' && m === 'GET') return ok({ ok: true, mode: 'live' });
  if (url === '/api/demo' && m === 'GET') return ok({ enabled: false, accounts: [] });
  if (url === '/api/places' && m === 'GET') return ok({ places: searchSuburbs(q.get('q') || '') });
  if (url === '/api/launch' && m === 'GET') {
    const place = resolveSuburb(q.get('suburb') || '');
    const zone = place ? launchStatus(place) : { open: false, km: null };
    return ok({
      suburb: place ? place.name : '',
      open: !!(place && zone.open),
      km: zone.km,
      radiusKm: launchRadiusKm(),
      center: LAUNCH_CENTER,
    });
  }

  const shareGet = url.match(/^\/api\/shares\/([a-f0-9]+)$/);
  if (shareGet && m === 'GET') {
    const rpc = await supabase.rpc('share_records', { p_token: shareGet[1] });
    if (!rpc || rpc.error || !rpc.data) return fail(404, 'This share link is not valid.');
    return ok({ records: rpc.data });
  }

  if (url === '/api/auth/signup' && m === 'POST') {
    const email = String(input.email || '').trim().toLowerCase();
    const name = String(input.name || '').trim().slice(0, 80);
    const password = String(input.password || '');
    const phone = String(input.phone || '').trim().slice(0, 30);
    if (name.length < 2) return fail(400, 'Add your name');
    if (!emailOk(email)) return fail(400, 'Enter a valid email address');
    if (password.length < 8) return fail(400, 'Use at least 8 characters for the password');
    const { data, error } = await supabase.auth.signUp({ email, password, options: { data: { name } } });
    if (error) return fail(400, friendlyAuth(error.message));
    const id = data.user && data.user.id;
    if (id && data.session) {
      await changed(supabase.from('profiles').upsert({ id, email, name }, { onConflict: 'id' }));
      if (phone) await changed(supabase.from('profile_phones').upsert({ user_id: id, phone }, { onConflict: 'user_id' }));
    }
    if (!data.session) return ok({ pending: true, message: 'Check your email to confirm your account, then log in.' });
    return ok({ user: await loadPublicUser(supabase, data.user), pending: false });
  }

  if (url === '/api/auth/login' && m === 'POST') {
    const email = String(input.email || '').trim().toLowerCase();
    const password = String(input.password || '');
    if (!emailOk(email) || !password) return fail(400, 'Enter your email and password');
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if (error || !data.user) return fail(400, 'That email or password is not right.');
    return ok({ user: await loadPublicUser(supabase, data.user) });
  }

  if (url === '/api/auth/magic' && m === 'POST') {
    const email = String(input.email || '').trim().toLowerCase();
    if (!emailOk(email)) return fail(400, 'Enter a valid email address');
    const { error } = await supabase.auth.signInWithOtp({ email, options: { emailRedirectTo: emailRedirect() } });
    if (error) return fail(400, friendlyAuth(error.message));
    return ok({ sent: true, message: 'Check your email for a sign-in link. Open it on this phone.' });
  }

  if (url === '/api/auth/phone' && m === 'POST') {
    const phone = String(input.phone || '').trim();
    if (phone.length < 8) return fail(400, 'Add a mobile number');
    const { error } = await supabase.auth.signInWithOtp({ phone });
    if (error) return fail(400, friendlyAuth(error.message));
    return ok({ sent: true, message: 'If phone sign-in is switched on, the code is on its way.' });
  }

  if (url === '/api/auth/phone/verify' && m === 'POST') {
    const phone = String(input.phone || '').trim();
    const token = String(input.token || input.code || '').trim();
    if (!phone || !token) return fail(400, 'Add the code from the text message');
    const { data, error } = await supabase.auth.verifyOtp({ phone, token, type: 'sms' });
    if (error || !data.user) return fail(400, friendlyAuth((error && error.message) || 'That code did not work.'));
    await ensureProfile(supabase, data.user);
    return ok({ user: await loadPublicUser(supabase, data.user) });
  }

  if (url === '/api/auth/logout' && m === 'POST') {
    await supabase.auth.signOut();
    return ok({ ok: true });
  }

  if (url === '/api/auth/me' && m === 'GET') {
    if (!authUser) return ok({ user: null });
    return ok(await workspace(supabase, authUser));
  }

  const gate = requireUser(authUser);
  if (gate) return gate;

  if (url === '/api/auth/profile' && m === 'PATCH') return updateProfile(supabase, authUser, input);
  if (url === '/api/me/settings' && m === 'PATCH') return updateProfile(supabase, authUser, input);
  if (url === '/api/auth/account' && m === 'DELETE') {
    const rpc = await supabase.rpc('delete_own_account');
    if (rpc && rpc.error) return fail(400, dbError(rpc.error));
    await supabase.auth.signOut();
    return ok({ ok: true });
  }

  if (url === '/api/waitlist' && m === 'POST') {
    const email = String(input.email || authUser.email || '').trim().toLowerCase();
    const suburb = String(input.suburb || '').trim();
    if (!emailOk(email)) return fail(400, 'Enter a valid email address');
    const place = resolveSuburb(suburb);
    if (!place) return fail(400, 'Choose a suburb from the list.');
    if (launchStatus(place).open) return fail(400, 'That suburb is already open. You can post a task.');
    await changed(supabase.from('waitlist').insert({
      email,
      name: String(input.name || '').slice(0, 80),
      suburb: place.name,
    }));
    return ok({ already: false });
  }

  if (url === '/api/me/notifications/read' && m === 'POST') {
    await changed(supabase.from('notifications').update({ read: true }).eq('user_id', authUser.id));
    return ok({ ok: true });
  }

  if (url === '/api/me/searches' && m === 'POST') {
    const saved = await changed(supabase.from('saved_searches').insert({
      user_id: authUser.id,
      q: String(input.q || '').slice(0, 160),
      cat: String(input.cat || 'all').slice(0, 40),
      km: input.km == null ? null : Number(input.km),
      sort: String(input.sort || 'closest').slice(0, 40),
      alert: input.alert !== false,
    }).select('*').single());
    const pack = await workspace(supabase, authUser);
    return ok({ savedSearch: { id: numId(saved.id) }, savedSearches: pack.savedSearches });
  }

  const searchPatch = url.match(/^\/api\/me\/searches\/(\d+)$/);
  if (searchPatch && m === 'PATCH') {
    await changed(supabase.from('saved_searches').update({ alert: !!input.alert }).eq('id', Number(searchPatch[1])).eq('user_id', authUser.id));
    return ok({ savedSearches: (await workspace(supabase, authUser)).savedSearches });
  }
  if (searchPatch && m === 'DELETE') {
    await changed(supabase.from('saved_searches').delete().eq('id', Number(searchPatch[1])).eq('user_id', authUser.id));
    return ok({ savedSearches: (await workspace(supabase, authUser)).savedSearches });
  }

  if (url === '/api/me/records' && m === 'POST') {
    const list = Array.isArray(input.records) ? input.records : [];
    const ids = [];
    for (const row of list) {
      const saved = await changed(supabase.from('records').insert({
        user_id: authUser.id,
        title: String(row.title || '').slice(0, 160),
        cat: String(row.cat || '').slice(0, 40),
        tasker_name: String(row.taskerName || '').slice(0, 80),
        date: String(row.date || '').slice(0, 40),
        paid: Number(row.paid) || 0,
        suburb: String(row.suburb || '').slice(0, 80),
        prop_private: String(row.propPrivate || '').slice(0, 200),
        check_text: String(row.check || '').slice(0, 80),
        note: String(row.note || '').slice(0, 500),
        photo_count: Number(row.photoCount) || 0,
      }).select('*').single());
      ids.push(numId(saved.id));
    }
    return ok({ ids });
  }

  if (url === '/api/me/records.csv' && m === 'GET') {
    const pack = await workspace(supabase, authUser);
    const lines = ['title,category,tasker,date,paid,suburb,property,note'];
    for (const row of pack.records) {
      lines.push([row.title, row.cat, row.taskerName, row.date, row.paid, row.suburb, row.property, row.note].map(csvCell).join(','));
    }
    return { status: 200, csv: `${lines.join('\n')}\n`, filename: 'taskspeck-jobs.csv', json: {} };
  }

  if (url === '/api/me/shares' && m === 'POST') {
    const token = (globalThis.crypto && crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}`).replace(/-/g, '');
    const share = await changed(supabase.from('shares').insert({ user_id: authUser.id, token }).select('*').single());
    for (const id of input.recordIds || []) {
      await changed(supabase.from('share_items').insert({ share_id: share.id, record_id: Number(id) }));
    }
    return ok({ token });
  }

  if (url === '/api/tasks' && m === 'GET') {
    const jobs = await rows(supabase.from('jobs').select('*').eq('published', true));
    const tasks = [];
    for (const job of jobs) {
      if (['Draft', 'CANCELLED', 'UNDER_REVIEW'].includes(job.stage)) continue;
      tasks.push(await presentJob(supabase, job, authUser.id));
    }
    return ok({ tasks });
  }

  if (url === '/api/tasks/draft' && m === 'PUT') return saveDraft(supabase, authUser, input);

  const bidEdit = url.match(/^\/api\/bids\/(\d+)$/);
  if (bidEdit && m === 'PATCH') return editBid(supabase, authUser, Number(bidEdit[1]), input);
  const bidWithdraw = url.match(/^\/api\/bids\/(\d+)\/withdraw$/);
  if (bidWithdraw && m === 'POST') return withdrawBid(supabase, authUser, Number(bidWithdraw[1]));

  const taskGet = url.match(/^\/api\/tasks\/(\d+)$/);
  if (taskGet && m === 'GET') {
    const job = await mustJob(supabase, taskGet[1]);
    if (!job.published && !same(job.requester_id, authUser.id)) return fail(404, 'Task not found');
    return ok({ task: await presentJob(supabase, job, authUser.id) });
  }

  const taskAction = url.match(/^\/api\/tasks\/(\d+)\/([a-z-]+)$/);
  if (taskAction) {
    const id = Number(taskAction[1]);
    const action = taskAction[2];
    if (action === 'publish' && m === 'POST') return publishJob(supabase, authUser, id, input);
    if (action === 'bids' && m === 'POST') return placeBid(supabase, authUser, id, input);
    if (action === 'accept-bid' && m === 'POST') return acceptBid(supabase, authUser, id, input);
    if (action === 'messages' && m === 'GET') return listMessages(supabase, authUser, id);
    if (action === 'messages' && m === 'POST') return postMessage(supabase, authUser, id, input);
    if (action === 'report' && m === 'POST') return fileReport(supabase, authUser, id, input);
    if (action === 'review' && m === 'POST') return addReview(supabase, authUser, id, input);
    if (action === 'repeat' && m === 'POST') return bookRepeat(supabase, authUser, id, input);
    if (action === 'on-the-way' && m === 'POST') return moveStage(supabase, authUser, id, 'ON_THE_WAY', ['UPCOMING', 'ACCEPTED', 'PAYMENT_CONFIRMED']);
    if (action === 'start' && m === 'POST') return moveStage(supabase, authUser, id, 'TASK_STARTED', ['UPCOMING', 'ACCEPTED', 'PAYMENT_CONFIRMED', 'ON_THE_WAY']);
    if (action === 'before-photos' && m === 'POST') return saveBefore(supabase, authUser, id, input);
    if (action === 'complete' && m === 'POST') return completeJob(supabase, authUser, id, input);
    if (action === 'approve-payment' && m === 'POST') return releasePay(supabase, authUser, id);
    if (action === 'cancel' && m === 'POST') return cancelJob(supabase, authUser, id, input);
    if (action === 'no-show' && m === 'POST') return noShow(supabase, authUser, id);
    if (action === 'rematch' && m === 'POST') return rematch(supabase, authUser, id);
    if (action === 'fix' && m === 'POST') return askFix(supabase, authUser, id, input);
    if (action === 'fix-done' && m === 'POST') return fixDone(supabase, authUser, id);
    if (action === 'dispute' && m === 'POST') return dispute(supabase, authUser, id, input);
    if (action === 'refund' && m === 'POST') return refund(supabase, authUser, id, input);
    if (action === 'bundle' && m === 'PUT') return saveBundle(supabase, authUser, id, input.bundle ?? input);
  }

  return { status: 404, json: { error: 'Not found' } };
}

function csvCell(value) {
  const s = value == null ? '' : String(value);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

async function updateProfile(supabase, authUser, patch) {
  const profile = await ensureProfile(supabase, authUser);
  const next = {};
  if (patch.name != null) {
    const name = String(patch.name).trim().slice(0, 80);
    if (name.length < 2) return fail(400, 'Add your name');
    next.name = name;
  }
  if (patch.bio != null) next.bio = String(patch.bio).trim().slice(0, 600);
  if (patch.areas != null) next.areas = String(patch.areas).trim().slice(0, 160);
  if (patch.vehicle != null) next.vehicle = String(patch.vehicle).trim().slice(0, 80);
  if (patch.role != null) {
    const role = String(patch.role);
    if (!['requester', 'tasker', 'both'].includes(role)) return fail(400, 'Choose Requester, Tasker, or both');
    next.role = role;
  }
  if (patch.suburb != null) {
    const hit = resolveSuburb(patch.suburb);
    if (!hit) return fail(400, 'Choose a suburb from the list.');
    next.suburb = hit.name;
    next.lat = hit.lat;
    next.lng = hit.lng;
    next.city_id = hit.cityId;
  }
  if (patch.safetyGuide != null) next.safety_guide = !!patch.safetyGuide;
  const settings = { ...(profile.settings || {}) };
  if (patch.demoMode != null) settings.demoMode = !!patch.demoMode;
  if (patch.notif && typeof patch.notif === 'object') settings.notif = { ...(settings.notif || {}), ...patch.notif };
  if (patch.avail && typeof patch.avail === 'object') settings.avail = { ...(settings.avail || {}), ...patch.avail };
  next.settings = settings;
  next.updated_at = nowIso();
  await changed(supabase.from('profiles').update(next).eq('id', authUser.id));
  if (patch.phone != null) {
    await changed(supabase.from('profile_phones').upsert({
      user_id: authUser.id,
      phone: String(patch.phone).trim().slice(0, 30),
    }, { onConflict: 'user_id' }));
  }
  return ok({ user: await loadPublicUser(supabase, authUser) });
}

async function saveDraft(supabase, authUser, input) {
  const text = String(input.text ?? '').slice(0, 8000);
  if (input.id != null && input.id !== '') {
    const job = await mustJob(supabase, input.id);
    if (!same(job.requester_id, authUser.id)) return fail(403, 'You can only edit your own draft');
    await changed(supabase.from('jobs').update({ text, updated_at: nowIso() }).eq('id', job.id));
    return ok({ task: await presentJob(supabase, await mustJob(supabase, job.id), authUser.id) });
  }
  const profile = await ensureProfile(supabase, authUser);
  const place = resolveSuburb(profile.suburb || '');
  const created = await changed(supabase.from('jobs').insert({
    requester_id: authUser.id,
    text,
    title: '',
    cat: 'other',
    stage: 'Draft',
    status: 'Draft',
    published: false,
    suburb: place ? place.name : '',
    lat: place ? place.lat : null,
    lng: place ? place.lng : null,
    city_id: place ? place.cityId : '',
    budget_label: 'Open to offers',
  }).select('*').single());
  return ok({ task: await presentJob(supabase, created, authUser.id) });
}

async function publishJob(supabase, authUser, id, meta) {
  const job = await mustJob(supabase, id);
  if (!same(job.requester_id, authUser.id)) return fail(403, 'Only the person who posted this task can publish it');
  if (['CANCELLED', 'NO_SHOW', 'COMPLETED', 'PAYMENT_RELEASED', 'RESOLVED', 'UPCOMING'].includes(job.stage)) {
    return fail(409, 'A booked task cannot be opened again. Post a new task instead.');
  }
  const text = meta.text != null ? String(meta.text) : (job.text || '');
  const title = meta.title != null ? String(meta.title) : (job.title || '');
  const cat = meta.cat != null ? String(meta.cat) : (job.cat || 'other');
  const blocked = prohibitedReason(text) || highRiskAnswer(meta.answers || {});
  if (blocked) return fail(400, blocked);
  const over = registeredWorkReason(
    { cat, text: `${title} ${text}`, title },
    {
      priceNum: meta.priceNum != null && meta.priceNum !== '' ? meta.priceNum : job.price_num,
      budgetLabel: meta.budgetLabel != null ? meta.budgetLabel : job.budget_label,
      milestones: Array.isArray(meta.milestones) ? meta.milestones : job.milestones,
    },
  );
  if (over) return fail(400, over);
  const place = resolveSuburb(meta.suburb != null ? meta.suburb : (job.suburb || ''));
  if (!place) return fail(400, 'Choose a suburb for this task.');
  const zone = launchStatus(place);
  if (!zone.open) return fail(403, comingSoonMessage());
  const priceRaw = meta.priceNum != null && meta.priceNum !== '' ? Number(meta.priceNum) : job.price_num;
  const patch = {
    text: text.slice(0, 8000),
    title: title.slice(0, 140),
    cat: cat.slice(0, 40),
    suburb: place.name,
    lat: place.lat,
    lng: place.lng,
    city_id: place.cityId,
    budget_label: meta.budgetLabel != null ? String(meta.budgetLabel).slice(0, 80) : (job.budget_label || 'Open to offers'),
    price_num: Number.isFinite(Number(priceRaw)) ? Number(priceRaw) : null,
    start_at: meta.startAt != null ? meta.startAt : job.start_at,
    start_min: meta.startMin != null && meta.startMin !== '' ? Number(meta.startMin) : job.start_min,
    duration_min: meta.durationMin != null && meta.durationMin !== '' ? Number(meta.durationMin) : job.duration_min,
    photo_count: meta.photoCount != null ? Math.min(8, Number(meta.photoCount) || 0) : (job.photo_count || 0),
    notes: Array.isArray(meta.notes) ? meta.notes.map((n) => String(n).slice(0, 300)).slice(0, 12) : (job.notes || []),
    special: Array.isArray(meta.special) ? meta.special.map((n) => String(n).slice(0, 300)).slice(0, 12) : (job.special || []),
    milestones: Array.isArray(meta.milestones) ? meta.milestones : (job.milestones || []),
    published: true,
    stage: job.stage === 'OFFERS_RECEIVED' ? 'OFFERS_RECEIVED' : 'POSTED',
    status: 'Open',
    updated_at: nowIso(),
  };
  await changed(supabase.from('jobs').update(patch).eq('id', job.id));
  if (meta.address != null || meta.prop != null) {
    const existing = await first(supabase.from('job_private').select('*').eq('job_id', job.id));
    await changed(supabase.from('job_private').upsert({
      job_id: job.id,
      address: meta.address != null ? String(meta.address).slice(0, 200) : ((existing && existing.address) || ''),
      prop_private: meta.prop != null ? String(meta.prop).slice(0, 200) : ((existing && existing.prop_private) || ''),
    }, { onConflict: 'job_id' }));
  }
  return ok({ task: await presentJob(supabase, await mustJob(supabase, job.id), authUser.id) });
}

async function placeBid(supabase, authUser, id, input) {
  const job = await mustJob(supabase, id);
  if (same(job.requester_id, authUser.id)) return fail(400, 'You cannot offer on your own task');
  if (!['POSTED', 'OFFERS_RECEIVED'].includes(job.stage)) return fail(409, 'This task is not open for offers');
  const fee = Number(input.fee);
  if (!Number.isFinite(fee) || fee <= 0) return fail(400, 'Add a price');
  const over = registeredWorkReason(
    { cat: job.cat, text: `${job.title || ''} ${job.text || ''}`, title: job.title },
    { fee, priceNum: job.price_num, budgetLabel: job.budget_label },
  );
  if (over) return fail(400, over);
  const profile = await ensureProfile(supabase, authUser);
  const saved = await changed(supabase.from('offers').insert({
    job_id: job.id,
    tasker_id: authUser.id,
    tasker_name: profile.name || 'Tasker',
    fee,
    message: String(input.message || '').slice(0, 1000),
    status: 'pending',
  }).select('*').single());
  if (job.stage === 'POSTED') {
    await changed(supabase.from('jobs').update({ stage: 'OFFERS_RECEIVED', status: 'Open', updated_at: nowIso() }).eq('id', job.id));
  }
  await tell(supabase, job.requester_id, 'offer', 'New offer', `${shortName(profile.name || 'A Tasker')} offered $${fee}.`, job.id);
  const bid = {
    id: numId(saved.id),
    taskId: numId(job.id),
    taskerId: authUser.id,
    taskerName: profile.name || 'Tasker',
    fee,
    message: saved.message || '',
    status: 'pending',
  };
  return ok({ bid, task: await presentJob(supabase, await mustJob(supabase, job.id), authUser.id) });
}

async function editBid(supabase, authUser, id, input) {
  const offer = await first(supabase.from('offers').select('*').eq('id', id));
  if (!offer || !same(offer.tasker_id, authUser.id)) return fail(404, 'Offer not found');
  if (offer.status !== 'pending') return fail(409, 'That offer can no longer be edited');
  const fee = input.fee != null ? Number(input.fee) : Number(offer.fee);
  if (!Number.isFinite(fee) || fee <= 0) return fail(400, 'Add a price');
  await changed(supabase.from('offers').update({
    fee,
    message: input.message != null ? String(input.message).slice(0, 1000) : offer.message,
  }).eq('id', offer.id));
  const fresh = await first(supabase.from('offers').select('*').eq('id', offer.id));
  return ok({
    bid: {
      id: numId(fresh.id),
      taskId: numId(fresh.job_id),
      taskerId: fresh.tasker_id,
      taskerName: fresh.tasker_name,
      fee: Number(fresh.fee),
      message: fresh.message || '',
      status: fresh.status,
    },
  });
}

async function withdrawBid(supabase, authUser, id) {
  const offer = await first(supabase.from('offers').select('*').eq('id', id));
  if (!offer || !same(offer.tasker_id, authUser.id)) return fail(404, 'Offer not found');
  if (offer.status !== 'pending') return fail(409, 'That offer can no longer be withdrawn');
  await changed(supabase.from('offers').update({ status: 'withdrawn' }).eq('id', offer.id));
  return ok({ ok: true });
}

async function acceptBid(supabase, authUser, id, input) {
  const job = await mustJob(supabase, id);
  if (!same(job.requester_id, authUser.id)) return fail(403, 'Only the requester can accept an offer');
  if (!['POSTED', 'OFFERS_RECEIVED'].includes(job.stage)) return fail(409, 'This task is not open for acceptance');
  const offers = await jobOffers(supabase, job.id);
  let bid = input.bidId != null ? offers.find((o) => same(o.id, input.bidId)) : null;
  if (!bid && input.taskerName) {
    bid = offers.find((o) => o.status === 'pending' && o.tasker_name === input.taskerName && (input.fee == null || Number(o.fee) === Number(input.fee)));
  }
  if (!bid || bid.status !== 'pending') {
    return fail(404, 'No pending offer matches that Tasker. It may have been withdrawn. Refresh and try again.');
  }
  const over = registeredWorkReason(
    { cat: job.cat, text: `${job.title || ''} ${job.text || ''}`, title: job.title },
    { fee: Number(bid.fee), priceNum: job.price_num, budgetLabel: job.budget_label, milestones: job.milestones },
  );
  if (over) return fail(400, over);
  for (const other of offers) {
    if (!same(other.id, bid.id) && other.status === 'pending') {
      await changed(supabase.from('offers').update({ status: 'rejected' }).eq('id', other.id));
    }
  }
  await changed(supabase.from('offers').update({ status: 'accepted' }).eq('id', bid.id));
  const payment = splitPay(Number(bid.fee));
  await changed(supabase.from('jobs').update({
    stage: 'UPCOMING',
    status: 'Assigned',
    accepted_offer_id: bid.id,
    payment,
    payment_status: 'AUTHORISED',
    assigned_at: nowIso(),
    published: true,
    updated_at: nowIso(),
  }).eq('id', job.id));
  await tell(supabase, bid.tasker_id, 'booking', 'You are booked', `Your offer of $${bid.fee} was accepted.`, job.id);
  const fresh = await mustJob(supabase, job.id);
  return ok({
    task: await presentJob(supabase, fresh, authUser.id),
    bid: {
      id: numId(bid.id),
      taskId: numId(job.id),
      taskerId: bid.tasker_id,
      taskerName: bid.tasker_name,
      fee: Number(bid.fee),
      message: bid.message || '',
      status: 'accepted',
    },
  });
}

async function listMessages(supabase, authUser, id) {
  const job = await mustJob(supabase, id);
  const offers = await jobOffers(supabase, job.id);
  if (!canMessage(job, offers, authUser.id)) return fail(403, 'You cannot read these messages');
  let list = await rows(supabase.from('messages').select('*').eq('job_id', job.id));
  if (!isParty(job, offers, authUser.id)) {
    list = list.filter((message) => same(message.from_user_id, authUser.id) || same(message.from_user_id, job.requester_id));
  }
  const messages = [];
  for (const message of list) messages.push(await presentMessage(supabase, message, job, offers, authUser.id));
  return ok({ messages, warningText: CONTACT_WARNING, reminder: await reminderFor(supabase, job.id, authUser.id) });
}

async function postMessage(supabase, authUser, id, input) {
  const job = await mustJob(supabase, id);
  const offers = await jobOffers(supabase, job.id);
  if (!canMessage(job, offers, authUser.id)) return fail(403, 'You cannot message on this task');
  const text = String(input.text || '').trim();
  if (!text) return fail(400, 'Write a message first');
  if (text.length > 2000) return fail(400, 'That message is too long');
  const phonesAllowed = PHONE_OPEN.has(job.stage) && isParty(job, offers, authUser.id);
  const guarded = guardMessage(text, { phonesAllowed });
  const hidden = guarded.changed || guarded.text.includes(HIDDEN);
  const cash = !hidden && (CASH_PATTERN.test(text) || CASH_PATTERN.test(guarded.text));
  const prior = await rows(supabase.from('messages').select('*').eq('job_id', job.id));
  const accepted = offers.find((o) => o.status === 'accepted');
  let withUser = authUser.id;
  if (same(job.requester_id, authUser.id)) {
    const other = [...prior].reverse().find((message) => message.from_user_id && !same(message.from_user_id, authUser.id));
    withUser = (accepted && accepted.tasker_id) || (other && other.from_user_id) || null;
  }
  const saved = await changed(supabase.from('messages').insert({
    job_id: job.id,
    from_user_id: authUser.id,
    with_user_id: withUser,
    text: guarded.text,
    warning: hidden || cash,
  }).select('*').single());
  return ok({
    message: await presentMessage(supabase, saved, job, offers, authUser.id),
    warning: hidden || cash,
    warningText: hidden ? CHAT_WARNING : (cash ? CONTACT_WARNING : null),
    reminder: await reminderFor(supabase, job.id, authUser.id),
    hidden: HIDDEN,
  });
}

async function fileReport(supabase, authUser, id, input) {
  const job = await mustJob(supabase, id);
  const offers = await jobOffers(supabase, job.id);
  if (!canMessage(job, offers, authUser.id)) return fail(403, 'You cannot report on this task');
  const reason = String(input.reason || '').trim().slice(0, 200);
  if (!reason) return fail(400, 'Choose what happened');
  const accepted = offers.find((o) => o.status === 'accepted');
  const about = same(job.requester_id, authUser.id) ? (accepted && accepted.tasker_id) : job.requester_id;
  await changed(supabase.from('reports').insert({
    job_id: job.id,
    from_user_id: authUser.id,
    about_user_id: about || null,
    reason,
  }).select('*').single());
  const reminder = await reminderFor(supabase, job.id, authUser.id);
  return ok({ ok: true, reminder, reminderText: reminder ? RULE_REMINDER : null });
}

async function addReview(supabase, authUser, id, input) {
  const job = await mustJob(supabase, id);
  const offers = await jobOffers(supabase, job.id);
  if (!isParty(job, offers, authUser.id)) return fail(403, 'Only the customer and the Tasker can review this job');
  if (!['TASKER_COMPLETED', 'FIX_DONE', 'REQUESTER_CONFIRMED', 'PAYMENT_RELEASED', 'COMPLETED', 'RESOLVED'].includes(job.stage)) {
    return fail(409, 'You can review after the job is done');
  }
  const stars = Number(input.stars);
  if (!(stars >= 1 && stars <= 5)) return fail(400, 'Choose a star rating');
  const inserted = await supabase.from('reviews').insert({
    job_id: job.id,
    from_user_id: authUser.id,
    stars,
    text: String(input.text || '').slice(0, 1000),
    tags: Array.isArray(input.tags) ? input.tags.map((tag) => String(tag).slice(0, 40)).slice(0, 8) : [],
  }).select('*').single();
  if (inserted.error) {
    if (/duplicate|unique/i.test(inserted.error.message || '')) return fail(409, 'You have already reviewed this job');
    return fail(400, dbError(inserted.error));
  }
  return ok({ task: await presentJob(supabase, job, authUser.id) });
}

async function moveStage(supabase, authUser, id, stage, allowed) {
  const job = await mustJob(supabase, id);
  const offers = await jobOffers(supabase, job.id);
  if (!isParty(job, offers, authUser.id)) return fail(403, 'Only the customer or the booked Tasker can update this job');
  if (!allowed.includes(job.stage)) return fail(409, 'This job is not at that step yet');
  const patch = { stage, status: legacyStatus(stage) };
  if (stage === 'ON_THE_WAY') patch.on_the_way_at = nowIso();
  if (stage === 'TASK_STARTED') patch.started_at = job.started_at || nowIso();
  await saveJob(supabase, job, authUser.id, patch);
  return ok({ task: await presentJob(supabase, await mustJob(supabase, job.id), authUser.id) });
}

async function saveBefore(supabase, authUser, id, input) {
  const job = await mustJob(supabase, id);
  const offers = await jobOffers(supabase, job.id);
  if (!isParty(job, offers, authUser.id)) return fail(403, 'You cannot add photos to this job');
  const paths = await storePhotos(supabase, authUser.id, job.id, 'before', input.photos || []);
  if (!paths.length) return fail(400, 'Add a photo first');
  await saveJob(supabase, job, authUser.id, { before_paths: paths, photo_count: Math.max(job.photo_count || 0, paths.length) });
  return ok({ task: await presentJob(supabase, await mustJob(supabase, job.id), authUser.id) });
}

async function completeJob(supabase, authUser, id, input) {
  const job = await mustJob(supabase, id);
  const offers = await jobOffers(supabase, job.id);
  if (!isParty(job, offers, authUser.id)) return fail(403, 'Only the customer or the booked Tasker can complete this job');
  if (job.stage !== 'TASK_STARTED') return fail(409, 'Task must be started before it can be completed');
  const paths = await storePhotos(supabase, authUser.id, job.id, 'after', input.afterPhotos || []);
  if (!paths.length && !(Number(input.photoCount) > 0 && (job.after_paths || []).length)) {
    return fail(400, 'Add an after photo before marking the job done');
  }
  await saveJob(supabase, job, authUser.id, {
    stage: 'TASKER_COMPLETED',
    status: legacyStatus('TASKER_COMPLETED'),
    done_at: nowIso(),
    after_paths: paths.length ? paths : (job.after_paths || []),
    photo_count: paths.length || Number(input.photoCount) || job.photo_count || 0,
  });
  return ok({ task: await presentJob(supabase, await mustJob(supabase, job.id), authUser.id) });
}

async function releasePay(supabase, authUser, id) {
  const job = await mustJob(supabase, id);
  if (!same(job.requester_id, authUser.id)) return fail(403, 'Only the requester can release payment');
  if (!['TASKER_COMPLETED', 'FIX_DONE', 'REQUESTER_CONFIRMED'].includes(job.stage)) {
    return fail(409, 'Payment can be released after the job is marked complete');
  }
  if (!job.payment) return fail(409, 'There is no payment to release');
  if (job.payment.status === 'DISPUTED' || job.stage === 'DISPUTED') return fail(409, 'Payment is on hold until the problem is resolved');
  const payment = { ...job.payment, status: 'RELEASED' };
  await saveJob(supabase, job, authUser.id, { stage: 'COMPLETED', status: legacyStatus('COMPLETED'), payment, payment_status: 'RELEASED' });
  return ok({ task: await presentJob(supabase, await mustJob(supabase, job.id), authUser.id) });
}

function hoursUntil(job) {
  if (!job.start_at) return Infinity;
  const t = new Date(job.start_at).getTime();
  if (Number.isNaN(t)) return Infinity;
  return (t - Date.now()) / 36e5;
}

async function cancelJob(supabase, authUser, id, input) {
  const job = await mustJob(supabase, id);
  const offers = await jobOffers(supabase, job.id);
  if (!isParty(job, offers, authUser.id)) return fail(403, 'You are not part of this task');
  const allowed = ['POSTED', 'OFFERS_RECEIVED', 'ACCEPTED', 'PAYMENT_CONFIRMED', 'UPCOMING', 'ON_THE_WAY', 'TASK_STARTED'];
  if (!allowed.includes(job.stage)) return fail(409, 'This task cannot be cancelled at this stage');
  const byTasker = !same(job.requester_id, authUser.id);
  const payment = job.payment ? { ...job.payment } : null;
  if (payment && payment.status === 'AUTHORISED') {
    if (byTasker || hoursUntil(job) >= 24) {
      payment.callout = 0;
      payment.status = 'REFUNDED';
    } else {
      payment.callout = Math.round(payment.gross * 20) / 100;
      payment.status = 'PART_REFUND';
    }
  }
  await saveJob(supabase, job, authUser.id, {
    stage: 'CANCELLED',
    status: 'CANCELLED',
    cancelled_by: byTasker ? 'tasker' : 'requester',
    cancel_reason: String(input.reason || '').slice(0, 200),
    payment,
    payment_status: payment ? payment.status : job.payment_status,
  });
  return ok({ task: await presentJob(supabase, await mustJob(supabase, job.id), authUser.id) });
}

async function noShow(supabase, authUser, id) {
  const job = await mustJob(supabase, id);
  if (!same(job.requester_id, authUser.id)) return fail(403, 'Only the requester can report a no-show');
  if (!['UPCOMING', 'ACCEPTED', 'PAYMENT_CONFIRMED', 'ON_THE_WAY'].includes(job.stage)) {
    return fail(409, 'A no-show can only be reported before the job has started');
  }
  const payment = job.payment ? { ...job.payment, callout: 0, status: 'REFUNDED' } : null;
  const offers = await jobOffers(supabase, job.id);
  const accepted = offers.find((o) => o.status === 'accepted');
  if (accepted) await changed(supabase.from('offers').update({ status: 'noshow' }).eq('id', accepted.id));
  await saveJob(supabase, job, authUser.id, {
    stage: 'NO_SHOW',
    status: 'NO_SHOW',
    cancelled_by: 'tasker',
    payment,
    payment_status: payment ? 'REFUNDED' : job.payment_status,
  });
  return ok({ task: await presentJob(supabase, await mustJob(supabase, job.id), authUser.id) });
}

async function rematch(supabase, authUser, id) {
  const job = await mustJob(supabase, id);
  if (!same(job.requester_id, authUser.id)) return fail(403, 'Only the requester can re-match this task');
  if (job.stage !== 'NO_SHOW') return fail(409, 'Re-match is available after a no-show');
  await saveJob(supabase, job, authUser.id, {
    stage: 'OFFERS_RECEIVED',
    status: 'Open',
    accepted_offer_id: null,
    payment: null,
    payment_status: 'none',
    published: true,
  });
  return ok({ task: await presentJob(supabase, await mustJob(supabase, job.id), authUser.id) });
}

async function askFix(supabase, authUser, id, input) {
  const job = await mustJob(supabase, id);
  if (!same(job.requester_id, authUser.id)) return fail(403, 'Only the requester can ask for a fix');
  if (!['TASKER_COMPLETED', 'FIX_DONE'].includes(job.stage)) return fail(409, 'A fix can be requested after the Tasker marks the job complete');
  if (job.fix_used) return fail(409, 'The free fix for this job has already been used');
  const what = String(input.what || '').trim();
  if (!what) return fail(400, 'Say what needs fixing');
  const fixes = [...(job.fixes || []), { what: what.slice(0, 200), text: String(input.text || '').slice(0, 1000), raised: nowIso() }];
  await saveJob(supabase, job, authUser.id, { stage: 'FIX_REQUESTED', status: legacyStatus('FIX_REQUESTED'), fix_used: true, fixes });
  return ok({ task: await presentJob(supabase, await mustJob(supabase, job.id), authUser.id) });
}

async function fixDone(supabase, authUser, id) {
  const job = await mustJob(supabase, id);
  const offers = await jobOffers(supabase, job.id);
  if (!isParty(job, offers, authUser.id)) return fail(403, 'You cannot update this fix');
  if (job.stage !== 'FIX_REQUESTED') return fail(409, 'There is no open fix request');
  await saveJob(supabase, job, authUser.id, { stage: 'FIX_DONE', status: legacyStatus('FIX_DONE') });
  return ok({ task: await presentJob(supabase, await mustJob(supabase, job.id), authUser.id) });
}

async function dispute(supabase, authUser, id, input) {
  const job = await mustJob(supabase, id);
  const offers = await jobOffers(supabase, job.id);
  if (!isParty(job, offers, authUser.id)) return fail(403, 'Only the requester or the booked Tasker can report a problem');
  if (!['TASK_STARTED', 'TASKER_COMPLETED', 'FIX_REQUESTED', 'FIX_DONE', 'UPCOMING'].includes(job.stage)) {
    return fail(409, 'A problem cannot be reported at this stage');
  }
  const reason = String(input.reason || '').trim();
  if (!reason) return fail(400, 'Choose what happened');
  const payment = job.payment ? { ...job.payment, status: 'DISPUTED' } : job.payment;
  await saveJob(supabase, job, authUser.id, {
    stage: 'DISPUTED',
    status: legacyStatus('DISPUTED'),
    payment,
    payment_status: 'DISPUTED',
    dispute: { reason: reason.slice(0, 200), text: String(input.text || '').slice(0, 2000), status: 'OPEN', openedBy: authUser.id, at: nowIso() },
  });
  return ok({ task: await presentJob(supabase, await mustJob(supabase, job.id), authUser.id) });
}

async function refund(supabase, authUser, id, input) {
  const job = await mustJob(supabase, id);
  if (!same(job.requester_id, authUser.id)) return fail(403, 'Only the requester can record a refund on this task');
  if (!job.payment) return fail(409, 'There is no payment to refund');
  const payment = { ...job.payment };
  let stage = 'RESOLVED';
  if (input.outcome === 'partial') {
    const half = Math.round(payment.gross * 50) / 100;
    const fee = Math.round(half * FEE_PCT) / 100;
    payment.partial = {
      gross: half,
      fee,
      tasker: Math.round((half - fee) * 100) / 100,
      refund: Math.round((payment.gross - half) * 100) / 100,
    };
    payment.status = 'PART_RELEASE';
  } else {
    payment.callout = 0;
    payment.status = 'REFUNDED';
  }
  await saveJob(supabase, job, authUser.id, { stage, status: legacyStatus(stage), payment, payment_status: payment.status });
  return ok({ task: await presentJob(supabase, await mustJob(supabase, job.id), authUser.id) });
}

async function bookRepeat(supabase, authUser, id, input) {
  const src = await mustJob(supabase, id);
  if (!same(src.requester_id, authUser.id)) return fail(403, 'Only the customer can book this again');
  if (!['COMPLETED', 'PAYMENT_RELEASED', 'REQUESTER_CONFIRMED'].includes(src.stage)) {
    return fail(409, 'You can book again after the job is complete');
  }
  const offers = await jobOffers(supabase, src.id);
  const bid = offers.find((o) => o.status === 'accepted');
  if (!bid) return fail(409, 'The Tasker from this job cannot be booked again');
  const every = input.cadence === 'weekly' || input.cadence === 'fortnightly' ? input.cadence : 'once';
  const days = every === 'fortnightly' ? 14 : 7;
  const start = new Date(Date.now() + days * 864e5).toISOString();
  const payment = splitPay(Number(bid.fee));
  const created = await changed(supabase.from('jobs').insert({
    requester_id: src.requester_id,
    title: src.title,
    text: src.text,
    cat: src.cat,
    stage: 'UPCOMING',
    status: 'Assigned',
    published: true,
    suburb: src.suburb,
    lat: src.lat,
    lng: src.lng,
    city_id: src.city_id,
    budget_label: bid.fee ? `$${bid.fee}` : src.budget_label,
    price_num: Number(bid.fee),
    start_at: start,
    start_min: src.start_min,
    duration_min: src.duration_min,
    payment,
    payment_status: 'AUTHORISED',
    repeat_of: src.id,
    repeat_every: every,
    assigned_at: nowIso(),
    notes: src.notes || [],
    special: src.special || [],
  }).select('*').single());
  const copied = await changed(supabase.from('offers').insert({
    job_id: created.id,
    tasker_id: bid.tasker_id,
    tasker_name: bid.tasker_name,
    fee: bid.fee,
    message: 'Booked again',
    status: 'accepted',
  }).select('*').single());
  await changed(supabase.from('jobs').update({ accepted_offer_id: copied.id }).eq('id', created.id));
  const priv = await first(supabase.from('job_private').select('*').eq('job_id', src.id));
  if (priv) {
    await changed(supabase.from('job_private').insert({
      job_id: created.id,
      address: priv.address || '',
      prop_private: priv.prop_private || '',
    }));
  }
  await tell(supabase, bid.tasker_id, 'booking', 'Booked again', `You are booked ${every === 'once' ? 'again' : every}.`, created.id);
  return ok({ task: await presentJob(supabase, await mustJob(supabase, created.id), authUser.id) });
}

async function saveBundle(supabase, authUser, id, bundle) {
  const job = await mustJob(supabase, id);
  const offers = await jobOffers(supabase, job.id);
  if (!isParty(job, offers, authUser.id)) return fail(403, 'You are not part of this task');
  await saveJob(supabase, job, authUser.id, { bundle: bundle || null });
  return ok({ ok: true });
}

export function createSupabaseData({ supabase }) {
  if (!supabase) throw new Error('Supabase client is required');
  return withAuth({
    mode: 'live',
    async request(req) {
      try {
        return await route(supabase, req || {});
      } catch (err) {
        return { status: err.status || 500, json: { error: err.message || 'Something went wrong' } };
      }
    },
  });
}
