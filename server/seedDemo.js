import { DEMO_ACCOUNTS, DEMO_PASSWORD } from './demoAccounts.js';

function must(result, label) {
  if (!result || result.error) {
    throw new Error(`${label}: ${result ? result.error : 'no result'}`);
  }
  return result;
}

function hoursFromNow(hours) {
  return new Date(Date.now() + hours * 3600 * 1000).toISOString();
}

const JOBS = [
  { cat: 'moving', title: 'Help carry boxes to a new apartment', text: 'Help carry about 20 boxes from the lobby to level 6 in Carlton on Saturday.', suburb: 'Carlton', price: 220 },
  { cat: 'cleaning', title: 'End-of-lease clean for a one-bedroom', text: 'End-of-lease clean for a one-bedroom apartment in Fitzroy. Kitchen, bathroom and floors.', suburb: 'Fitzroy', price: 680 },
  { cat: 'garden', title: 'Tidy a small courtyard', text: 'Mow and weed a small courtyard in Richmond.', suburb: 'Richmond', price: 280 },
  { cat: 'home', title: 'Hang a mirror in the hallway', text: 'Hang a mirror in the hallway. Ground floor only. The owner has given permission.', suburb: 'East Melbourne', price: 160 },
  { cat: 'furniture', title: 'Assemble a desk and a bookshelf', text: 'Assemble a flat-pack desk and a bookshelf. All parts are in the box.', suburb: 'Southbank', price: 210 },
  { cat: 'errands', title: 'Collect a parcel from the post office', text: 'Collect a parcel from the post office and bring it to the apartment lobby.', suburb: 'Melbourne', price: 55 },
  { cat: 'rubbish', title: 'Take an old sofa to the tip', text: 'Remove an old sofa and take it to the tip.', suburb: 'North Melbourne', price: 340 },
  { cat: 'painting', title: 'Paint one bedroom', text: 'Paint one bedroom, ground floor only. The paint is supplied.', suburb: 'Parkville', price: 820 },
  { cat: 'packing', title: 'Pack the kitchen into boxes', text: 'Pack the kitchen into boxes before a move. Boxes are supplied.', suburb: 'West Melbourne', price: 290 },
  { cat: 'other', title: 'Sort a wardrobe', text: 'Help sort a wardrobe into keep and donate piles.', suburb: 'Collingwood', price: null },
];

async function makeAccount(db, spec) {
  const signed = must(db.signup({ name: spec.name, email: spec.email, password: DEMO_PASSWORD }), spec.email);
  const user = db.userFromToken(signed.token);
  must(db.updateProfile(user, {
    suburb: spec.suburb,
    demoMode: true,
    safetyGuide: !!spec.tasker,
    bio: spec.tasker ? 'Demo Tasker. Sample profile only.' : 'Demo requester. Sample profile only.',
    avail: spec.tasker ? { km: 10, days: [0, 1, 2, 3, 4, 5, 6], from: '00:00', to: '23:59', paused: false, cats: [] } : undefined,
  }), spec.email + ' profile');
  return db.userFromToken(signed.token);
}

export async function seedDemo(db) {
  db.resetStore();
  const byEmail = {};
  for (const spec of DEMO_ACCOUNTS) byEmail[spec.email] = await makeAccount(db, spec);
  const maya = byEmail['maya.demo@taskspeck.test'];
  const sam = byEmail['sam.demo@taskspeck.test'];
  const priya = byEmail['priya.demo@taskspeck.test'];
  const tasks = {};
  for (const job of JOBS) {
    const draft = must(db.upsertListingText(job.text, null, maya), job.title);
    const published = must(await db.publishListing(draft.task.id, {
      text: job.text,
      title: job.title,
      cat: job.cat,
      suburb: job.suburb,
      budgetLabel: job.price ? `$${job.price}` : 'Request quotes',
      priceNum: job.price,
      startAt: hoursFromNow(72),
      startMin: 600,
      photoCount: 1,
    }, maya), job.title);
    tasks[job.cat] = published.task;
  }
  const furnitureOffer = must(await db.placeBid(tasks.furniture.id, { fee: 190, message: 'I can bring a drill. Saturday morning works.' }, sam), 'furniture offer');
  must(await db.postMessage(tasks.furniture.id, sam, { text: 'Happy to assemble both pieces if the instructions are in the box.' }), 'furniture message');
  must(await db.postMessage(tasks.furniture.id, maya, { text: 'Yes, the instructions are there. Demo message only.' }), 'furniture reply');
  must(await db.placeBid(tasks.garden.id, { fee: 260, message: 'I can tidy the courtyard on Saturday.' }, sam), 'garden offer');
  must(await db.placeBid(tasks.packing.id, { fee: 270, message: 'I can pack the kitchen in one visit.' }, priya), 'packing offer');
  const cleanOffer = must(await db.placeBid(tasks.cleaning.id, { fee: 640, message: 'I can do the end-of-lease clean.' }, sam), 'clean offer');
  must(await db.acceptBid(tasks.cleaning.id, { bidId: cleanOffer.bid.id }, maya), 'accept clean');
  must(db.markStarted(tasks.cleaning.id, sam), 'start clean');
  must(db.markCompleted(tasks.cleaning.id, sam, { photoCount: 2 }), 'complete clean');
  must(await db.approvePayment(tasks.cleaning.id, maya), 'pay clean');
  must(await db.addReview(tasks.cleaning.id, maya, { stars: 5, text: 'Demo review: the clean was careful and the photos were clear.', tags: ['Reliability'] }), 'review');
  const upcoming = must(await db.placeBid(tasks.rubbish.id, { fee: 320, message: 'I have a ute for the sofa.' }, priya), 'rubbish offer');
  must(await db.acceptBid(tasks.rubbish.id, { bidId: upcoming.bid.id }, maya), 'accept rubbish');
  must(db.saveRecords(maya, [{
    title: 'End-of-lease clean for a one-bedroom',
    cat: 'cleaning',
    taskerName: 'Sam Taylor',
    date: 'Sat 31 Oct',
    paid: 640,
    suburb: 'Fitzroy',
    propPrivate: 'Demo apartment, Fitzroy',
    note: 'Demo record. No real money moved.',
    photoCount: 2,
    taskId: tasks.cleaning.id,
  }]), 'record');
  db.flushPersist();
  return { tasks, furnitureOfferId: furnitureOffer.bid.id };
}
