import assert from 'node:assert/strict';
import test from 'node:test';
import { createSupabaseData } from './supabaseData.js';

const NAME_OPEN = ['ACCEPTED', 'PAYMENT_CONFIRMED', 'UPCOMING', 'ON_THE_WAY', 'TASK_STARTED', 'TASKER_COMPLETED', 'FIX_REQUESTED', 'FIX_DONE', 'DISPUTED', 'REQUESTER_CONFIRMED', 'PAYMENT_RELEASED', 'COMPLETED', 'RESOLVED'];
const PHONE_OPEN = ['ACCEPTED', 'PAYMENT_CONFIRMED', 'UPCOMING', 'ON_THE_WAY', 'TASK_STARTED', 'FIX_REQUESTED', 'FIX_DONE', 'DISPUTED'];

function createFake() {
  const tables = {
    profiles: [],
    profile_phones: [],
    jobs: [],
    job_private: [],
    offers: [],
    messages: [],
    reviews: [],
    reports: [],
    notifications: [],
    saved_searches: [],
    records: [],
    shares: [],
    share_items: [],
    job_photos: [],
    waitlist: [],
  };
  let seq = 100;
  const calls = [];
  let uid = 'casey';

  function matches(row, filters) {
    return filters.every((filter) => String(row[filter[1]]) === String(filter[2]));
  }

  function query(table) {
    const filters = [];
    const api = {
      select() { return api; },
      eq(col, val) { filters.push(['eq', col, val]); return api; },
      order() { return api; },
      insert(row) {
        calls.push({ op: 'insert', table, row: { ...row } });
        const saved = { ...row };
        if (saved.id == null && !['profiles', 'profile_phones', 'job_private'].includes(table)) saved.id = seq++;
        tables[table].push(saved);
        const result = { data: saved, error: null };
        return {
          select() { return { single: async () => result, maybeSingle: async () => result }; },
          then(resolve, reject) { return Promise.resolve(result).then(resolve, reject); },
        };
      },
      update(patch) {
        calls.push({ op: 'update', table, patch });
        const upd = {
          eq(col, val) { filters.push(['eq', col, val]); return upd; },
          then(resolve, reject) {
            const found = tables[table].filter((row) => matches(row, filters));
            for (const row of found) Object.assign(row, patch);
            return Promise.resolve({ data: found, error: null }).then(resolve, reject);
          },
        };
        return upd;
      },
      delete() {
        calls.push({ op: 'delete', table });
        const del = {
          eq(col, val) { filters.push(['eq', col, val]); return del; },
          then(resolve, reject) {
            tables[table] = tables[table].filter((row) => !matches(row, filters));
            return Promise.resolve({ data: null, error: null }).then(resolve, reject);
          },
        };
        return del;
      },
      upsert(row) {
        calls.push({ op: 'upsert', table, row });
        const key = row.id != null ? 'id' : (row.user_id != null ? 'user_id' : 'job_id');
        let existing = tables[table].find((item) => item[key] === row[key]);
        if (existing) Object.assign(existing, row);
        else {
          existing = { ...row };
          tables[table].push(existing);
        }
        const result = { data: existing, error: null };
        return { then(resolve, reject) { return Promise.resolve(result).then(resolve, reject); } };
      },
      maybeSingle: async () => {
        calls.push({ op: 'select', table });
        const found = tables[table].filter((row) => {
          if (table === 'profile_phones' && row.user_id !== uid) return false;
          return matches(row, filters);
        });
        return { data: found[0] || null, error: null };
      },
      then(resolve, reject) {
        calls.push({ op: 'select', table });
        const found = tables[table].filter((row) => {
          if (table === 'profile_phones' && row.user_id !== uid) return false;
          return matches(row, filters);
        });
        return Promise.resolve({ data: found, error: null }).then(resolve, reject);
      },
    };
    return api;
  }

  return {
    tables,
    calls,
    setUser(id) { uid = id; },
    auth: {
      getSession: async () => ({ data: { session: { user: { id: uid, email: `${uid}@example.com` } } }, error: null }),
      signOut: async () => ({ error: null }),
      signUp: async () => ({ data: {}, error: null }),
      signInWithPassword: async () => ({ data: {}, error: { message: 'invalid login' } }),
      signInWithOtp: async () => ({ error: null }),
      verifyOtp: async () => ({ data: {}, error: { message: 'That code did not work.' } }),
    },
    from(table) {
      if (!tables[table]) tables[table] = [];
      return query(table);
    },
    async rpc(name, args) {
      calls.push({ op: 'rpc', name });
      if (name === 'offer_count') {
        return {
          data: tables.offers.filter((row) => String(row.job_id) === String(args.p_job_id) && row.status === 'pending').length,
          error: null,
        };
      }
      if (name !== 'job_contact') return { data: null, error: null };
      const job = tables.jobs.find((row) => String(row.id) === String(args.p_job_id));
      const accepted = tables.offers.find((row) => String(row.job_id) === String(args.p_job_id) && row.status === 'accepted');
      const party = job && (job.requester_id === uid || (accepted && accepted.tasker_id === uid));
      if (!party) return { data: null, error: null };
      const priv = tables.job_private.find((row) => String(row.job_id) === String(job.id));
      const booked = NAME_OPEN.includes(job.stage);
      const phones = PHONE_OPEN.includes(job.stage);
      const reqPhone = tables.profile_phones.find((row) => row.user_id === job.requester_id);
      const taskerPhone = accepted && tables.profile_phones.find((row) => row.user_id === accepted.tasker_id);
      return {
        data: {
          address: (uid === job.requester_id || booked) ? (priv && priv.address) : null,
          prop_private: null,
          requester_phone: phones && reqPhone ? reqPhone.phone : null,
          tasker_phone: phones && taskerPhone ? taskerPhone.phone : null,
        },
        error: null,
      };
    },
    storage: {
      from() {
        return {
          upload: async () => ({ error: null }),
          createSignedUrl: async (path) => ({ data: { signedUrl: `https://example.supabase.co/storage/${path}` }, error: null }),
        };
      },
    },
  };
}

function seed(fake) {
  fake.tables.profiles.push(
    { id: 'maya', name: 'Maya Chen', email: 'maya@example.com', suburb: 'North Melbourne', role: 'requester', settings: {} },
    { id: 'sam', name: 'Sam Taylor', email: 'sam@example.com', suburb: 'Southbank', role: 'tasker', settings: {} },
    { id: 'casey', name: 'Casey Nguyen', email: 'casey@example.com', suburb: 'Carlton', role: 'both', settings: {} },
  );
  fake.tables.profile_phones.push(
    { user_id: 'maya', phone: '0412 000 111' },
    { user_id: 'sam', phone: '0413 000 222' },
  );
  fake.tables.jobs.push({
    id: 5,
    requester_id: 'maya',
    title: 'Move a sofa',
    text: 'Saturday morning',
    cat: 'moving',
    stage: 'POSTED',
    status: 'Open',
    suburb: 'North Melbourne',
    lat: -37.8,
    lng: 144.95,
    published: true,
    price_num: 100,
    budget_label: '$100',
    address: '14 Secret St SHOULD NOT LEAK',
    payment: null,
    before_paths: [],
    after_paths: [],
  });
  fake.tables.job_private.push({ job_id: 5, address: '14 Curzon St, North Melbourne VIC 3051', prop_private: '' });
  fake.tables.offers.push({
    id: 3,
    job_id: 5,
    tasker_id: 'sam',
    tasker_name: 'Sam Taylor',
    fee: 100,
    message: 'I can help',
    status: 'pending',
  });
}

test('live data layer keeps street and phone off the public job until booking', async () => {
  const fake = createFake();
  seed(fake);
  const layer = createSupabaseData({ supabase: fake });
  assert.equal(layer.mode, 'live');

  fake.setUser('casey');
  fake.calls.length = 0;
  const hidden = await layer.request({ method: 'GET', path: '/api/tasks/5' });
  assert.equal(hidden.status, 200);
  const dumped = JSON.stringify(hidden.json);
  assert.equal(dumped.includes('Secret'), false);
  assert.equal(dumped.includes('Curzon'), false);
  assert.equal(dumped.includes('0412'), false);
  assert.equal(dumped.includes('0413'), false);
  assert.equal(hidden.json.task.requesterName, 'Maya C');
  assert.equal(hidden.json.task.phones, undefined);
  assert.equal(hidden.json.task.address, undefined);
  assert.equal(fake.calls.some((call) => call.table === 'profile_phones'), false);

  fake.setUser('maya');
  const owner = await layer.request({ method: 'GET', path: '/api/tasks/5' });
  assert.match(owner.json.task.address, /Curzon/);
  assert.equal(owner.json.task.phones, undefined);
  assert.equal(JSON.stringify(owner.json).includes('Secret'), false);
  assert.equal(owner.json.task.bids[0].taskerName, 'Sam T');

  fake.setUser('sam');
  const message = await layer.request({
    method: 'POST',
    path: '/api/tasks/5/messages',
    body: { text: 'Call me on 0413 000 222' },
  });
  assert.equal(message.status, 200);
  assert.equal(message.json.message.text.includes('[hidden until booking]'), true);
  assert.equal(message.json.message.text.includes('0413'), false);
  assert.match(message.json.warningText, /once the job is booked/);
  const stored = fake.tables.messages.at(-1);
  assert.equal(stored.text.includes('0413'), false);

  fake.setUser('maya');
  const booked = await layer.request({
    method: 'POST',
    path: '/api/tasks/5/accept-bid',
    body: { bidId: 3 },
  });
  assert.equal(booked.status, 200, JSON.stringify(booked));
  assert.equal(booked.json.task.payment.gross, 100);
  assert.equal(booked.json.task.payment.fee, 15);
  assert.equal(booked.json.task.payment.tasker, 85);
  assert.equal(booked.json.task.bid.taskerName, 'Sam Taylor');
  assert.equal(booked.json.task.phones.tasker, '0413 000 222');
  assert.equal(booked.json.task.phones.requester, '0412 000 111');
  assert.match(booked.json.task.address, /Curzon/);
  assert.equal(JSON.stringify(booked.json).includes('Secret'), false);

  fake.setUser('sam');
  const openPhone = await layer.request({
    method: 'POST',
    path: '/api/tasks/5/messages',
    body: { text: 'The lobby phone is 0413 000 222' },
  });
  assert.equal(openPhone.json.message.text.includes('0413 000 222'), true);
  const email = await layer.request({
    method: 'POST',
    path: '/api/tasks/5/messages',
    body: { text: 'pat at gmail dot com' },
  });
  assert.equal(email.json.message.text.includes('gmail'), false);
  assert.equal(email.json.message.text.includes('[hidden until booking]'), true);

  fake.setUser('casey');
  const blocked = await layer.request({ method: 'GET', path: '/api/tasks/5/messages' });
  assert.equal(blocked.status, 403);

  const mark = fake.calls.length;
  fake.setUser('sam');
  const report = await layer.request({
    method: 'POST',
    path: '/api/tasks/5/report',
    body: { reason: 'Asked for my contact details' },
  });
  assert.equal(report.status, 200);
  assert.equal(report.json.ok, true);
  const reportCalls = fake.calls.slice(mark);
  assert.equal(reportCalls.some((call) => call.op === 'insert' && call.table === 'reports'), true);
  assert.equal(reportCalls.some((call) => call.op === 'update' && call.table === 'reports'), false);
  assert.equal(fake.tables.reports[0].reason, 'Asked for my contact details');
  assert.equal(fake.tables.reports[0].from_user_id, 'sam');
});
