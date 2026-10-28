import fs from 'fs';
import os from 'os';
import path from 'path';
import { before, test } from 'node:test';
import assert from 'node:assert/strict';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'taskspeck-'));
process.env.TASKSPECK_DATA = dir;
process.env.TASKSPECK_SYNC_SAVE = '1';
process.env.NOTIFY_PROVIDER = 'log';
process.env.NOTIFY_LOG_FILE = path.join(dir, 'notifications.log');

const db = await import('./db.js');
const { listAuthProviders, oauthUnavailable } = await import('./auth.js');

before(() => db.resetStore());

function future(hours) {
  return new Date(Date.now() + hours * 3600 * 1000).toISOString();
}

async function account(name, email) {
  const result = db.signup({ name, email, password: 'correct-horse' });
  assert.equal(result.error, undefined);
  assert.equal(result.user.password, undefined);
  const again = db.userFromToken(result.token);
  assert.equal(again.email, email);
  const raw = JSON.parse(fs.readFileSync(path.join(dir, 'store.json'), 'utf8'));
  const stored = raw.users.find((u) => u.email === email);
  assert.notEqual(stored.password.hash, 'correct-horse');
  assert.equal(stored.password.algo, 'scrypt');
  const placed = db.updateProfile(again, { suburb: 'Melbourne' });
  assert.equal(placed.error, undefined);
  assert.equal(placed.user.launch.open, true);
  assert.equal(placed.user.demoMode, false);
  return again;
}

test('password login rejects a wrong password and a second signup', async () => {
  db.resetStore();
  const user = await account('Alex Morgan', 'alex@example.com');
  const bad = db.login({ email: 'alex@example.com', password: 'nope-nope' });
  assert.equal(bad.code, 401);
  const dup = db.signup({ name: 'Alex', email: 'alex@example.com', password: 'correct-horse' });
  assert.equal(dup.code, 409);
  const ok = db.login({ email: 'Alex@Example.com', password: 'correct-horse' });
  assert.equal(ok.user.id, user.id);
});

test('a requester can post more than one task, and a booked task cannot be published again', async () => {
  db.resetStore();
  const alex = await account('Alex', 'alex@example.com');
  const a = db.upsertListingText('Assemble my desk on Saturday', null, alex);
  const b = db.upsertListingText('End-of-lease clean for my one-bedroom apartment', null, alex);
  assert.notEqual(a.task.id, b.task.id);
  const pubA = await db.publishListing(a.task.id, { text: a.task.text, title: 'Assemble my desk', cat: 'furniture', budgetLabel: '$80', priceNum: 80, startAt: future(72), startMin: 600 }, alex);
  const pubB = await db.publishListing(b.task.id, { text: b.task.text, title: 'End-of-lease clean', cat: 'cleaning', budgetLabel: '$220', priceNum: 220, startAt: future(72), startMin: 540 }, alex);
  assert.equal(pubA.task.stage, 'POSTED');
  assert.equal(pubB.task.stage, 'POSTED');
  assert.equal(db.getTaskListing(alex).length, 2);

  const sam = await account('Sam', 'sam@example.com');
  const offer = await db.placeBid(pubA.task.id, { fee: 80 }, sam);
  const accepted = await db.acceptBid(pubA.task.id, { bidId: offer.bid.id }, alex);
  assert.equal(accepted.task.stage, 'UPCOMING');
  assert.equal(accepted.task.payment.gross, 80);
  assert.equal(accepted.task.payment.fee, 12);
  assert.ok(accepted.task.address === '' || accepted.task.address === undefined || typeof accepted.task.address === 'string');

  const again = await db.publishListing(pubA.task.id, { text: 'Assemble my desk again', title: 'Assemble my desk' }, alex);
  assert.equal(again.code, 409);
  assert.match(again.error, /booked task cannot be opened again/i);
  const still = db.getTaskById(pubA.task.id, alex);
  assert.equal(still.stage, 'UPCOMING');
  assert.equal(still.paymentStatus, 'AUTHORISED');
});

test('accepting an offer that is not pending returns an error', async () => {
  db.resetStore();
  const alex = await account('Alex', 'alex@example.com');
  const draft = db.upsertListingText('Hang a mirror in the hallway', null, alex);
  const pub = await db.publishListing(draft.task.id, { text: draft.task.text, title: 'Hang a mirror', cat: 'home', startAt: future(48), startMin: 600 }, alex);
  const missing = await db.acceptBid(pub.task.id, { taskerName: 'Jordan', fee: 90 }, alex);
  assert.equal(missing.code, 404);
  assert.match(missing.error, /no pending offer/i);
  assert.equal(missing.task, undefined);
});

test('licensed work is refused by the server', async () => {
  db.resetStore();
  const alex = await account('Alex', 'alex@example.com');
  const draft = db.upsertListingText('Please rewire the power point', null, alex);
  const pub = await db.publishListing(draft.task.id, { text: 'Please rewire the power point', title: 'Rewire power point' }, alex);
  assert.equal(pub.code, 400);
  assert.match(pub.error, /doesn't offer licensed work/i);
});

test('taskers can edit and withdraw their own offers only', async () => {
  db.resetStore();
  const alex = await account('Alex', 'alex@example.com');
  const sam = await account('Sam Taylor', 'sam@example.com');
  const draft = db.upsertListingText('Collect a parcel from the post office', null, alex);
  const pub = await db.publishListing(draft.task.id, { text: draft.task.text, title: 'Collect a parcel', cat: 'errands', budgetLabel: 'Open to offers', startAt: future(48), startMin: 750, suburb: 'Melbourne CBD' }, alex);
  const bid = await db.placeBid(pub.task.id, { fee: 40, message: 'I can do noon' }, sam);
  assert.equal(bid.bid.taskerName, 'Sam Taylor');
  const edited = db.updateBid(bid.bid.id, { fee: 45, message: 'Updated time' }, sam);
  assert.equal(edited.bid.fee, 45);
  const stranger = await account('Jo', 'jo@example.com');
  const blocked = db.updateBid(bid.bid.id, { fee: 10 }, stranger);
  assert.equal(blocked.code, 403);
  const own = db.updateBid(bid.bid.id, { fee: 10 }, alex);
  assert.equal(own.code, 403);
  const gone = await db.withdrawBid(bid.bid.id, sam);
  assert.equal(gone.bid.status, 'withdrawn');
  const accept = await db.acceptBid(pub.task.id, { bidId: bid.bid.id }, alex);
  assert.equal(accept.code, 404);
});

test('cancel, no-show, fix, dispute, refund and review follow the person and the stage', async () => {
  db.resetStore();
  const alex = await account('Alex', 'alex@example.com');
  const sam = await account('Sam', 'sam@example.com');
  const other = await account('Other', 'other@example.com');

  async function booked(hours, cat = 'furniture') {
    const draft = db.upsertListingText('Assemble a bookshelf', null, alex);
    const pub = await db.publishListing(draft.task.id, {
      text: 'Assemble a bookshelf', title: 'Assemble a bookshelf', cat, budgetLabel: '$100', priceNum: 100,
      startAt: future(hours), startMin: 600, suburb: 'Melbourne CBD',
    }, alex);
    const bid = await db.placeBid(pub.task.id, { fee: 100 }, sam);
    const accepted = await db.acceptBid(pub.task.id, { bidId: bid.bid.id }, alex);
    assert.equal(accepted.error, undefined);
    return accepted.task;
  }

  const soon = await booked(2);
  const notTheir = await db.cancelTask(soon.id, other, { reason: 'Changed plans' });
  assert.equal(notTheir.code, 403);
  const earlyNoShow = await db.reportNoShow(soon.id, sam);
  assert.equal(earlyNoShow.code, 403);
  const cancelled = await db.cancelTask(soon.id, alex, { reason: 'Changed plans' });
  assert.equal(cancelled.task.stage, 'CANCELLED');
  assert.equal(cancelled.task.payment.status, 'PART_REFUND');
  assert.equal(cancelled.refund.callout, 20);

  const later = await booked(48);
  const full = await db.cancelTask(later.id, alex, { reason: 'Changed plans' });
  assert.equal(full.task.payment.status, 'REFUNDED');
  assert.equal(full.refund.callout, 0);

  const job = await booked(48, 'cleaning');
  const tooSoon = await db.reportNoShow(job.id, alex);
  assert.equal(tooSoon.task.stage, 'NO_SHOW');
  assert.equal(tooSoon.task.payment.status, 'REFUNDED');
  assert.equal(tooSoon.refund.refund, 100);
  const rematch = db.rematchTask(job.id, alex);
  assert.equal(rematch.task.stage, 'OFFERS_RECEIVED');
  const strangerRematch = db.rematchTask(job.id, other);
  assert.equal(strangerRematch.code, 403);

  const work = await booked(48, 'cleaning');
  const fixEarly = await db.requestFix(work.id, alex, { what: 'Oven' });
  assert.equal(fixEarly.code, 409);
  const started = db.markStarted(work.id, sam);
  assert.equal(started.task.stage, 'TASK_STARTED');
  const noPhoto = db.markCompleted(work.id, sam, { photoCount: 0 });
  assert.equal(noPhoto.code, 400);
  const done = db.markCompleted(work.id, sam, { photoCount: 2 });
  assert.equal(done.task.stage, 'TASKER_COMPLETED');
  const fix = await db.requestFix(work.id, alex, { what: 'Oven or kitchen' });
  assert.equal(fix.task.stage, 'FIX_REQUESTED');
  const second = await db.requestFix(work.id, alex, { what: 'Bathroom' });
  assert.equal(second.code, 409);
  const fixed = db.markFixed(work.id, sam, { photoCount: 1 });
  assert.equal(fixed.task.stage, 'FIX_DONE');
  const paid = await db.approvePayment(work.id, alex);
  assert.equal(paid.task.payment.status, 'RELEASED');
  assert.equal(paid.task.stage, 'COMPLETED');
  const reviewEarlyUser = await db.addReview(work.id, other, { stars: 5 });
  assert.equal(reviewEarlyUser.code, 403);
  const review = await db.addReview(work.id, alex, { stars: 5, text: 'Careful and on time' });
  assert.equal(review.review.stars, 5);
  const twice = await db.addReview(work.id, alex, { stars: 4 });
  assert.equal(twice.code, 409);

  const disputeJob = await booked(48, 'furniture');
  db.markStarted(disputeJob.id, alex);
  const badDispute = await db.openDispute(disputeJob.id, other, { reason: 'Damage' });
  assert.equal(badDispute.code, 403);
  const dispute = await db.openDispute(disputeJob.id, alex, { reason: 'Damage' });
  assert.equal(dispute.task.stage, 'DISPUTED');
  assert.equal(dispute.task.payment.status, 'DISPUTED');
  const held = await db.approvePayment(disputeJob.id, alex);
  assert.equal(held.code, 409);
  const decided = await db.applyRefund(disputeJob.id, alex, { outcome: 'partial' });
  assert.equal(decided.task.stage, 'RESOLVED');
  assert.equal(decided.task.payment.status, 'PART_RELEASE');
  const taskerDecision = await db.applyRefund(disputeJob.id, sam, { outcome: 'refund' });
  assert.equal(taskerDecision.code, 403);
});

test('people can message before an offer is accepted', async () => {
  db.resetStore();
  const alex = await account('Alex', 'alex@example.com');
  const sam = await account('Sam', 'sam@example.com');
  const draft = db.upsertListingText('Help carry boxes to level 18', null, alex);
  const pub = await db.publishListing(draft.task.id, { text: draft.task.text, title: 'Carry boxes', cat: 'moving', startAt: future(30), startMin: 840 }, alex);
  const asked = await db.postMessage(pub.task.id, sam, { text: 'Does the lift booking cover 2pm?' });
  assert.equal(asked.error, undefined);
  assert.equal(pub.task.stage, 'POSTED');
  const reply = await db.postMessage(pub.task.id, alex, { text: 'Yes, 2pm to 3pm. Can I pay cash instead?' });
  assert.equal(reply.warning, true);
  assert.match(reply.warningText, /cash/i);
  const seen = db.listMessages(pub.task.id, sam);
  assert.ok(seen.messages.some((m) => m.text.includes('lift')));
  assert.equal(db.getTaskById(pub.task.id, sam).stage, 'POSTED');
});

test('saved-search alerts follow availability, and job-day notices send once', async () => {
  db.resetStore();
  const alex = await account('Alex', 'alex@example.com');
  const sam = await account('Sam', 'sam@example.com');
  db.updateProfile(sam, {
    suburb: 'Melbourne CBD',
    avail: { days: [0, 1, 2, 3, 4, 5, 6], from: '09:00', to: '17:00', km: 5, cats: ['cleaning'], paused: false },
    notif: { offers: true, messages: true, reminders: true, nearby: false, email: true, sms: false },
  });
  const quiet = await account('Quiet', 'quiet@example.com');
  db.updateProfile(quiet, {
    suburb: 'Melbourne CBD',
    avail: { days: [0, 1, 2, 3, 4, 5, 6], from: '09:00', to: '17:00', km: 5, cats: ['furniture'], paused: false },
    notif: { nearby: true, email: true },
  });
  db.saveSearch(sam, { q: 'lease', cat: 'cleaning', km: 5, alert: true });
  const start = new Date();
  start.setHours(10, 0, 0, 0);
  const draft = db.upsertListingText('End-of-lease clean for a one-bedroom apartment', null, alex);
  await db.publishListing(draft.task.id, {
    text: draft.task.text, title: 'End-of-lease clean', cat: 'cleaning', budgetLabel: '$200', priceNum: 200,
    startAt: start.toISOString(), startMin: 600, suburb: 'Melbourne CBD',
  }, alex);
  const notes = db.listNotifications(sam);
  assert.ok(notes.some((n) => n.kind === 'search'));
  assert.equal(db.listNotifications(quiet).length, 0);

  const log = fs.readFileSync(process.env.NOTIFY_LOG_FILE, 'utf8');
  assert.match(log, /sam@example.com/);
  assert.match(log, /End-of-lease clean/);

  const offer = await db.placeBid(draft.task.id, { fee: 180 }, sam);
  db.updateProfile(alex, { notif: { offers: false, reminders: true, messages: true, email: true } });
  const before = db.listNotifications(alex).length;
  await db.placeBid(draft.task.id, { fee: 190 }, quiet);
  assert.equal(db.listNotifications(alex).length, before);

  const accepted = await db.acceptBid(draft.task.id, { bidId: offer.bid.id }, alex);
  assert.equal(accepted.task.stage, 'UPCOMING');
  const first = await db.sweepJobDays(start);
  const second = await db.sweepJobDays(start);
  const jobNotes = db.listNotifications(sam).filter((n) => n.kind === 'jobday');
  assert.equal(jobNotes.length, 1);
  assert.equal(second.sent, 0);
  assert.ok(first.sent >= 1);
});

test('a share link and its CSV leave out the private address', async () => {
  db.resetStore();
  const alex = await account('Alex', 'alex@example.com');
  const saved = db.saveRecords(alex, [{
    title: 'End-of-lease clean',
    cat: 'cleaning',
    taskerName: 'Priya',
    date: 'Fri 2 Oct',
    paid: 220,
    suburb: 'Melbourne CBD',
    propPrivate: 'Unit 1204, 200 Spencer St',
    photoCount: 3,
  }]);
  const ownerCsv = db.csvForUser(alex);
  assert.match(ownerCsv, /Spencer/);
  const share = db.createShare(alex, { recordIds: saved.ids });
  const pub = db.getPublicShare(share.token);
  const blob = JSON.stringify(pub);
  assert.equal(pub.privateAddress, false);
  assert.doesNotMatch(blob, /Spencer|1204|Unit/);
  assert.equal(pub.records[0].suburb, 'Melbourne CBD');
  assert.equal(pub.records[0].property, undefined);
  assert.equal(pub.records[0].propPrivate, undefined);
  assert.equal(pub.records[0].address, undefined);
  const csv = db.csvForShare(share.token).csv;
  assert.doesNotMatch(csv, /Spencer|1204|property/);
  assert.match(csv, /End-of-lease clean/);
  assert.match(csv, /Melbourne CBD/);
});

test('profile edits stick and a deleted account cannot sign in', async () => {
  db.resetStore();
  const alex = await account('Alex', 'alex@example.com');
  const updated = db.updateProfile(alex, { name: 'Alex M', phone: '0400000000', suburb: 'Southbank', bio: 'I post small jobs.' });
  assert.equal(updated.user.name, 'Alex M');
  assert.equal(updated.user.suburb, 'Southbank');
  assert.ok(updated.user.lat < -37.82);
  db.deleteAccount(alex);
  const gone = db.login({ email: 'alex@example.com', password: 'correct-horse' });
  assert.equal(gone.code, 401);
});

test('launch zone is 10 km from the city centre, with a waitlist outside it', async () => {
  db.resetStore();
  delete process.env.LAUNCH_EXTRA_SUBURBS;
  delete process.env.LAUNCH_RADIUS_KM;
  const richmond = db.zoneFor('Richmond');
  const frankston = db.zoneFor('Frankston');
  assert.equal(richmond.radiusKm, 10);
  assert.equal(richmond.open, true);
  assert.ok(richmond.km < 10);
  assert.equal(frankston.open, false);
  assert.ok(frankston.km > 10);
  const alex = await account('Alex', 'alex@example.com');
  db.updateProfile(alex, { suburb: 'Frankston' });
  const draft = db.upsertListingText('Mow the lawn and tidy the edges', null, alex);
  const blocked = await db.publishListing(draft.task.id, { text: draft.task.text, title: 'Mow the lawn', cat: 'garden', suburb: 'Frankston' }, alex);
  assert.equal(blocked.code, 403);
  assert.match(blocked.error, /Coming soon to your area/);
  assert.match(blocked.error, /10 km/);
  const joined = db.joinWaitlist({ email: 'alex@example.com', suburb: 'Frankston', name: 'Alex' });
  assert.equal(joined.entry.suburb, 'Frankston');
  const csv = db.waitlistCsv();
  assert.match(csv, /alex@example.com/);
  assert.match(csv, /Frankston/);
  const openAlready = db.joinWaitlist({ email: 'alex@example.com', suburb: 'Richmond' });
  assert.equal(openAlready.code, 400);
  process.env.LAUNCH_EXTRA_SUBURBS = 'Frankston';
  assert.equal(db.zoneFor('Frankston').open, true);
  const opened = await db.publishListing(draft.task.id, { text: draft.task.text, title: 'Mow the lawn', cat: 'garden', suburb: 'Frankston', budgetLabel: 'Request quotes' }, alex);
  assert.equal(opened.error, undefined);
  delete process.env.LAUNCH_EXTRA_SUBURBS;
  const far = await account('Far', 'far@example.com');
  db.updateProfile(far, { suburb: 'Frankston', avail: { km: 50, cats: [], days: [0, 1, 2, 3, 4, 5, 6], from: '00:00', to: '23:59', paused: false }, notif: { nearby: true, email: false } });
  const near = await account('Near', 'near@example.com');
  db.updateProfile(near, { suburb: 'Carlton', avail: { km: 10, cats: [], days: [0, 1, 2, 3, 4, 5, 6], from: '00:00', to: '23:59', paused: false }, notif: { nearby: true, email: false } });
  const city = db.upsertListingText('Assemble a large wardrobe', null, alex);
  db.updateProfile(alex, { suburb: 'Richmond' });
  await db.publishListing(city.task.id, { text: 'Assemble a large wardrobe', title: 'Assemble a wardrobe', cat: 'furniture', suburb: 'Richmond', budgetLabel: '$400', priceNum: 400, startAt: future(48), startMin: 600 }, alex);
  const outsider = await db.placeBid(city.task.id, { fee: 400 }, far);
  assert.equal(outsider.code, 403);
  assert.match(outsider.error, /Coming soon/);
  const insider = await db.placeBid(city.task.id, { fee: 380 }, near);
  assert.equal(insider.error, undefined);
});

test('demo offers stay off unless Demo mode is on, and large unlicensed jobs are allowed', async () => {
  db.resetStore();
  const alex = await account('Alex', 'alex@example.com');
  const sam = await account('Sam', 'sam@example.com');
  const draft = db.upsertListingText('Help me organise a warehouse move over three days', null, alex);
  const pub = await db.publishListing(draft.task.id, {
    text: draft.task.text,
    title: 'Three-day warehouse move',
    cat: 'moving',
    suburb: 'Richmond',
    budgetLabel: '$48000',
    priceNum: 48000,
    milestones: [{ title: 'Pack and load', amount: 20000 }, { title: 'Deliver and unpack', amount: 28000 }],
    startAt: future(72),
    startMin: 480,
  }, alex);
  assert.equal(pub.error, undefined);
  assert.equal(pub.task.milestones.length, 2);
  assert.equal(pub.task.cat, 'moving');
  const fake = await db.placeBid(pub.task.id, { taskerName: 'Jordan', fee: 48000 }, alex);
  assert.equal(fake.code, 403);
  assert.match(fake.error, /Demo mode/);
  db.updateProfile(alex, { demoMode: true });
  const sample = await db.placeBid(pub.task.id, { taskerName: 'Jordan', fee: 47000 }, alex);
  assert.equal(sample.bid.source, 'demo');
  const seenBySam = db.getTaskById(pub.task.id, sam);
  assert.equal(seenBySam.bids.some((b) => b.taskerName === 'Jordan'), false);
  const real = await db.placeBid(pub.task.id, { fee: 46000 }, sam);
  assert.equal(real.error, undefined);
  assert.equal(real.bid.taskerName, 'Sam');
  const accepted = await db.acceptBid(pub.task.id, { bidId: real.bid.id }, alex);
  assert.equal(accepted.task.payment.gross, 46000);
  db.markStarted(pub.task.id, sam);
  const partial = await db.releaseMilestone(pub.task.id, 1, alex);
  assert.equal(partial.milestone.status, 'released');
  assert.equal(partial.task.milestones[1].status, 'held');
  assert.notEqual(partial.task.payment.status, 'RELEASED');
  const other = await db.publishListing((db.upsertListingText('Paint two rooms', null, alex)).task.id, {
    text: 'Paint two bedrooms, ground floor only', title: 'Paint two rooms', cat: 'painting', suburb: 'Carlton', budgetLabel: 'Request quotes', priceNum: 120000,
  }, alex);
  assert.equal(other.code, 400);
  assert.match(other.error, /registered builder/);
  const licensed = await db.publishListing((db.upsertListingText('Rewire the kitchen', null, alex)).task.id, {
    text: 'Rewire the kitchen', title: 'Rewire the kitchen', cat: 'other', suburb: 'Carlton',
  }, alex);
  assert.equal(licensed.code, 400);
  assert.match(licensed.error, /doesn't offer licensed work/);
});

test('building-type jobs over $10,000 are refused, including quotes and stages', async () => {
  const { REGISTERED_WORK_LIMIT_AUD, REGISTERED_WORK_MESSAGE } = await import('../shared/registeredWork.js');
  assert.equal(REGISTERED_WORK_LIMIT_AUD, 10000);
  assert.match(REGISTERED_WORK_MESSAGE, /registered builder/);
  assert.doesNotMatch(REGISTERED_WORK_MESSAGE, /split/i);
  db.resetStore();
  const alex = await account('Alex', 'builder@example.com');
  const sam = await account('Sam', 'builder-sam@example.com');
  const limit = REGISTERED_WORK_LIMIT_AUD;

  const atLimit = await db.publishListing((db.upsertListingText('Paint one bedroom', null, alex)).task.id, {
    text: 'Paint one bedroom, ground floor only', title: 'Paint one bedroom', cat: 'painting', suburb: 'Carlton',
    budgetLabel: `$${limit}`, priceNum: limit,
  }, alex);
  assert.equal(atLimit.error, undefined);

  const overBudget = await db.publishListing((db.upsertListingText('Paint the hall', null, alex)).task.id, {
    text: 'Paint the hallway, ground floor only', title: 'Paint the hall', cat: 'painting', suburb: 'Carlton',
    budgetLabel: `$${limit + 1}`, priceNum: limit + 1,
  }, alex);
  assert.equal(overBudget.code, 400);
  assert.equal(overBudget.error, REGISTERED_WORK_MESSAGE);

  const handyman = await db.publishListing((db.upsertListingText('Patch a wall', null, alex)).task.id, {
    text: 'Patch a wall mark and repaint that patch only', title: 'Patch a wall', cat: 'home', suburb: 'Richmond',
    priceNum: 15000, budgetLabel: '$15000',
  }, alex);
  assert.equal(handyman.code, 400);
  assert.match(handyman.error, /registered builder/);

  const assembly = await db.publishListing((db.upsertListingText('Assemble kitchen cabinets', null, alex)).task.id, {
    text: 'Assemble a run of kitchen cabinets', title: 'Assemble cabinets', cat: 'furniture', suburb: 'Carlton',
    priceNum: 15000, budgetLabel: '$15000',
  }, alex);
  assert.equal(assembly.code, 400);

  const stages = await db.publishListing((db.upsertListingText('Paint two rooms in stages', null, alex)).task.id, {
    text: 'Paint two bedrooms, ground floor only', title: 'Paint in stages', cat: 'painting', suburb: 'Carlton',
    budgetLabel: 'Request quotes',
    milestones: [{ title: 'Prep', amount: 6000 }, { title: 'Paint', amount: 5000 }],
  }, alex);
  assert.equal(stages.code, 400);
  assert.match(stages.error, /registered builder/);
  assert.doesNotMatch(stages.error, /split/i);

  const labelled = await db.publishListing((db.upsertListingText('Paint the study', null, alex)).task.id, {
    text: 'Paint the study, ground floor only', title: 'Paint the study', cat: 'painting', suburb: 'Carlton',
    budgetLabel: '$12,000',
  }, alex);
  assert.equal(labelled.code, 400);

  const smallReno = await db.publishListing((db.upsertListingText('Renovate the study shelves', null, alex)).task.id, {
    text: 'Renovate the study shelves, ground floor only', title: 'Shelf refresh', cat: 'other', suburb: 'Carlton',
    budgetLabel: '$400', priceNum: 400,
  }, alex);
  assert.equal(smallReno.error, undefined);

  const bigReno = await db.publishListing((db.upsertListingText('Renovate the study', null, alex)).task.id, {
    text: 'Renovate the study shelves and paint them', title: 'Study renovation', cat: 'other', suburb: 'Carlton',
    budgetLabel: '$11000', priceNum: 11000,
  }, alex);
  assert.equal(bigReno.code, 400);
  assert.match(bigReno.error, /registered builder/);

  const quotes = await db.publishListing((db.upsertListingText('Paint the spare room', null, alex)).task.id, {
    text: 'Paint the spare room, ground floor only', title: 'Paint the spare room', cat: 'painting', suburb: 'Carlton',
    budgetLabel: 'Request quotes',
  }, alex);
  assert.equal(quotes.error, undefined);
  const highQuote = await db.placeBid(quotes.task.id, { fee: limit + 1 }, sam);
  assert.equal(highQuote.code, 400);
  assert.match(highQuote.error, /registered builder/);
  const okQuote = await db.placeBid(quotes.task.id, { fee: limit }, sam);
  assert.equal(okQuote.error, undefined);
  const raised = db.updateBid(okQuote.bid.id, { fee: 12000 }, sam);
  assert.equal(raised.code, 400);
  assert.match(raised.error, /registered builder/);

  const clean = await db.publishListing((db.upsertListingText('Vacuum the lounge', null, alex)).task.id, {
    text: 'Vacuum the lounge', title: 'Vacuum the lounge', cat: 'cleaning', suburb: 'Carlton', budgetLabel: 'Request quotes',
  }, alex);
  const bigClean = await db.placeBid(clean.task.id, { fee: 15000 }, sam);
  assert.equal(bigClean.error, undefined);
  const recat = await db.publishListing(clean.task.id, {
    text: 'Paint the lounge, ground floor only', title: 'Paint the lounge', cat: 'painting', suburb: 'Carlton', budgetLabel: 'Request quotes',
  }, alex);
  assert.equal(recat.error, undefined);
  const accepted = await db.acceptBid(clean.task.id, { bidId: bigClean.bid.id }, alex);
  assert.equal(accepted.code, 400);
  assert.match(accepted.error, /registered builder/);
  assert.doesNotMatch(accepted.error, /split/i);

  const structural = await db.publishListing((db.upsertListingText('Knock out a wall', null, alex)).task.id, {
    text: 'Knock out a wall between the rooms', title: 'Knock out a wall', cat: 'home', suburb: 'Carlton', priceNum: 500,
  }, alex);
  assert.equal(structural.code, 400);
  assert.match(structural.error, /doesn't offer licensed work/);
});

test('events and hosting tasks are stored as Other, and packing stays its own category', async () => {
  db.resetStore();
  const alex = await account('Alex', 'pack@example.com');
  const party = await db.publishListing((db.upsertListingText('Set up chairs', null, alex)).task.id, {
    text: 'Set up chairs for a birthday', title: 'Party setup', cat: 'events', suburb: 'Carlton', budgetLabel: 'Request quotes',
  }, alex);
  assert.equal(party.task.cat, 'other');
  const turnover = await db.publishListing((db.upsertListingText('Hand over the apartment', null, alex)).task.id, {
    text: 'Hand over the apartment after a short stay', title: 'Apartment handover', cat: 'hosting', suburb: 'Carlton', budgetLabel: '$150', priceNum: 150,
  }, alex);
  assert.equal(turnover.task.cat, 'other');
  const packed = await db.publishListing((db.upsertListingText('Pack the kitchen', null, alex)).task.id, {
    text: 'Pack the kitchen into boxes', title: 'Pack the kitchen', cat: 'packing', suburb: 'Carlton', budgetLabel: '$180', priceNum: 180,
  }, alex);
  assert.equal(packed.task.cat, 'packing');
  const file = path.join(dir, 'store.json');
  const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
  const row = raw.tasks.find((task) => task.title === 'Party setup');
  row.cat = 'hosting';
  row.bundle = { task: { cat: 'events', title: 'Party setup' } };
  raw.records.push({ id: 1, userId: alex.id, cat: 'events', title: 'Old party', date: '', paid: 0, suburb: 'Carlton' });
  raw.savedSearches.push({ id: 1, userId: alex.id, cat: 'hosting', q: 'party', km: 10, alert: false });
  fs.writeFileSync(file, JSON.stringify(raw));
  const fresh = await import('./db.js?retired=1');
  assert.equal(fresh.getTaskById(row.id, alex).cat, 'other');
  fresh.flushPersist();
  const again = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.equal(again.tasks.find((task) => task.id === row.id).cat, 'other');
  assert.equal(again.tasks.find((task) => task.id === row.id).bundle.task.cat, 'other');
  assert.equal(again.records[0].cat, 'other');
  assert.equal(again.savedSearches[0].cat, 'other');
});

test('Google and Apple sign-in are present but not required', () => {
  const providers = listAuthProviders();
  assert.equal(providers.find((p) => p.id === 'password').enabled, true);
  assert.equal(providers.find((p) => p.id === 'google').enabled, false);
  assert.equal(providers.find((p) => p.id === 'apple').enabled, false);
  const google = oauthUnavailable('google');
  assert.equal(google.code, 501);
  assert.match(google.error, /GOOGLE_CLIENT_ID/);
});
