import assert from 'node:assert/strict';

function memoryStorage() {
  const map = new Map();
  return {
    getItem: (key) => (map.has(key) ? map.get(key) : null),
    setItem: (key, value) => map.set(String(key), String(value)),
    removeItem: (key) => map.delete(key),
  };
}

globalThis.localStorage = memoryStorage();
process.env.TASKSPECK_DEMO = '0';
process.env.TASKSPECK_SYNC_SAVE = '1';

const { createDataLayer } = await import('./createDataLayer.js');
const { BROWSER_STORE_KEY } = await import('../../server/persist.js');

const layer = await createDataLayer({ storage: globalThis.localStorage });
assert.equal(layer.mode, 'local');

function unpack(result, what) {
  const status = result && result.status;
  const json = (result && result.json) || {};
  if (!result || (status && status >= 400) || json.error) {
    throw new Error(`${what} failed: ${JSON.stringify(result)}`);
  }
  return { json, token: result.tokenSet || '' };
}

const photo = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==';

const maya = unpack(await layer.auth.signUp({
  name: 'Maya Chen',
  email: 'maya.live@example.com',
  password: 'password1',
  phone: '0412 000 111',
}), 'maya signup');
const sam = unpack(await layer.auth.signUp({
  name: 'Sam Taylor',
  email: 'sam.live@example.com',
  password: 'password1',
  phone: '0413 000 222',
}), 'sam signup');
const casey = unpack(await layer.auth.signUp({
  name: 'Casey Nguyen',
  email: 'casey.live@example.com',
  password: 'password1',
}), 'casey signup');

assert.ok(maya.token && sam.token && casey.token);
assert.equal(maya.json.user.name, 'Maya Chen');
const stored = localStorage.getItem(BROWSER_STORE_KEY);
assert.ok(stored, 'the local layer should write the store into localStorage');
assert.equal(stored.includes('maya.live@example.com'), true);

const suburb = unpack(await layer.request({
  method: 'PATCH',
  path: '/api/auth/profile',
  token: maya.token,
  body: { suburb: 'North Melbourne' },
}), 'suburb');
assert.equal(suburb.json.user.suburb, 'North Melbourne');
unpack(await layer.request({
  method: 'PATCH',
  path: '/api/auth/profile',
  token: sam.token,
  body: { suburb: 'Southbank' },
}), 'sam suburb');

const draft = unpack(await layer.request({
  method: 'PUT',
  path: '/api/tasks/draft',
  token: maya.token,
  body: { text: 'Move a sofa on Saturday' },
}), 'draft');
const taskId = draft.json.task.id;

const published = unpack(await layer.request({
  method: 'POST',
  path: `/api/tasks/${taskId}/publish`,
  token: maya.token,
  body: {
    text: 'Move a sofa on Saturday. The price is $100.',
    title: 'Move a sofa',
    cat: 'moving',
    suburb: 'North Melbourne',
    address: '14 Curzon St, North Melbourne VIC 3051',
    budgetLabel: '$100',
    priceNum: 100,
  },
}), 'publish');
assert.equal(published.json.task.address, '14 Curzon St, North Melbourne VIC 3051');

const stranger = unpack(await layer.request({
  method: 'GET',
  path: `/api/tasks/${taskId}`,
  token: casey.token,
}), 'casey reads the open job');
assert.equal(stranger.json.task.requesterName, 'Maya C');
assert.equal(stranger.json.task.address, undefined);
assert.equal(stranger.json.task.phones, undefined);
assert.equal(JSON.stringify(stranger.json).includes('Curzon'), false);
assert.equal(JSON.stringify(stranger.json).includes('0412'), false);

const safe = unpack(await layer.request({
  method: 'POST',
  path: `/api/tasks/${taskId}/messages`,
  token: sam.token,
  body: { text: 'Does the lift booking cover 2pm? The price is $120. 12 Spencer St, 3000.' },
}), 'safe message');
assert.equal(safe.json.message.text, 'Does the lift booking cover 2pm? The price is $120. 12 Spencer St, 3000.');
assert.equal(safe.json.warning, false);

const hidden = unpack(await layer.request({
  method: 'POST',
  path: `/api/tasks/${taskId}/messages`,
  token: sam.token,
  body: { text: 'Call me on 0413 000 222' },
}), 'phone message');
assert.equal(hidden.json.message.text.includes('[hidden until booking]'), true);
assert.equal(hidden.json.message.text.includes('0413'), false);
assert.match(hidden.json.warningText, /Contact details are shared automatically once the job is booked/);

const caseyThread = unpack(await layer.request({
  method: 'GET',
  path: `/api/tasks/${taskId}/messages`,
  token: casey.token,
}), 'casey reads chat before booking');
assert.equal(JSON.stringify(caseyThread.json).includes('0413'), false);
assert.equal(caseyThread.json.messages.some((message) => String(message.text).includes('[hidden until booking]')), false);

const bid = unpack(await layer.request({
  method: 'POST',
  path: `/api/tasks/${taskId}/bids`,
  token: sam.token,
  body: { fee: 100, taskerName: 'Sam Taylor', message: 'I can help on Saturday.' },
}), 'bid');
assert.equal(bid.json.bid.taskerName, 'Sam Taylor');

const mayaView = unpack(await layer.request({
  method: 'GET',
  path: `/api/tasks/${taskId}`,
  token: maya.token,
}), 'maya sees the offer');
const offer = (mayaView.json.task.bids || []).find((row) => row.id === bid.json.bid.id);
assert.ok(offer);
assert.equal(offer.taskerName, 'Sam T');

const booked = unpack(await layer.request({
  method: 'POST',
  path: `/api/tasks/${taskId}/accept-bid`,
  token: maya.token,
  body: { bidId: bid.json.bid.id },
}), 'accept');
assert.equal(booked.json.task.payment.gross, 100);
assert.equal(booked.json.task.payment.fee, 15);
assert.equal(booked.json.task.payment.tasker, 85);
assert.equal(booked.json.task.bid.taskerName, 'Sam Taylor');
assert.match(booked.json.task.address, /Curzon/);
assert.equal(booked.json.task.phones.requester, '0412 000 111');
assert.equal(booked.json.task.phones.tasker, '0413 000 222');

const samBooked = unpack(await layer.request({
  method: 'GET',
  path: `/api/tasks/${taskId}`,
  token: sam.token,
}), 'sam after booking');
assert.equal(samBooked.json.task.requesterName, 'Maya Chen');
assert.match(samBooked.json.task.address, /Curzon/);
assert.equal(samBooked.json.task.phones.requester, '0412 000 111');

const caseyAfter = await layer.request({
  method: 'GET',
  path: `/api/tasks/${taskId}/messages`,
  token: casey.token,
});
assert.equal(caseyAfter.status, 403);

const allowed = unpack(await layer.request({
  method: 'POST',
  path: `/api/tasks/${taskId}/messages`,
  token: sam.token,
  body: { text: 'I am on 0413 000 222 if the lobby is locked' },
}), 'phone after booking');
assert.equal(allowed.json.message.text.includes('0413 000 222'), true);
assert.equal(allowed.json.message.text.includes('[hidden until booking]'), false);

const email = unpack(await layer.request({
  method: 'POST',
  path: `/api/tasks/${taskId}/messages`,
  token: sam.token,
  body: { text: 'Or email pat at gmail dot com' },
}), 'email after booking');
assert.equal(email.json.message.text.includes('gmail'), false);
assert.equal(email.json.message.text.includes('[hidden until booking]'), true);

unpack(await layer.request({ method: 'POST', path: `/api/tasks/${taskId}/start`, token: sam.token, body: {} }), 'start');
const done = unpack(await layer.request({
  method: 'POST',
  path: `/api/tasks/${taskId}/complete`,
  token: sam.token,
  body: { afterPhotos: [photo], photoCount: 1 },
}), 'complete');
assert.equal(done.json.task.phones, undefined);
assert.match(done.json.task.address, /Curzon/);
assert.equal(done.json.task.requesterName, 'Maya Chen');

const late = unpack(await layer.request({
  method: 'POST',
  path: `/api/tasks/${taskId}/messages`,
  token: sam.token,
  body: { text: 'Call me later on 0413 000 222' },
}), 'phone after done');
assert.equal(late.json.message.text.includes('0413'), false);
assert.equal(late.json.message.text.includes('[hidden until booking]'), true);

const firstReport = unpack(await layer.request({
  method: 'POST',
  path: `/api/tasks/${taskId}/report`,
  token: maya.token,
  body: { reason: 'Asked for my contact details' },
}), 'report');
assert.equal(firstReport.json.ok, true);
const secondReport = unpack(await layer.request({
  method: 'POST',
  path: `/api/tasks/${taskId}/report`,
  token: maya.token,
  body: { reason: 'Asked to pay cash or outside TaskSpeck' },
}), 'second report');
assert.equal(secondReport.json.reminder, true);

const again = await createDataLayer({ storage: globalThis.localStorage });
const still = unpack(await again.request({ method: 'GET', path: '/api/auth/me', token: maya.token }), 'reload');
assert.equal(still.json.user.name, 'Maya Chen');
assert.ok((still.json.tasks || []).some((task) => task.id === taskId));
