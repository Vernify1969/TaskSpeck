import { spawnSync } from 'node:child_process';
import path from 'path';
import { test } from 'node:test';
import assert from 'node:assert/strict';

test('the phone demo keeps each visitor’s data and the same rules', () => {
  const script = `
    const mem = new Map();
    globalThis.localStorage = {
      getItem(key) { return mem.has(key) ? mem.get(key) : null; },
      setItem(key, value) { mem.set(key, String(value)); },
      removeItem(key) { mem.delete(key); },
    };
    process.env.TASKSPECK_DEMO = '1';
    process.env.TASKSPECK_SYNC_SAVE = '1';
    process.env.NOTIFY_PROVIDER = 'log';
    const db = await import(${JSON.stringify(path.join(process.cwd(), 'server/db.js'))});
    const { seedDemo } = await import(${JSON.stringify(path.join(process.cwd(), 'server/seedDemo.js'))});
    const { dispatch } = await import(${JSON.stringify(path.join(process.cwd(), 'server/apiDispatch.js'))});
    const { DEMO_PASSWORD } = await import(${JSON.stringify(path.join(process.cwd(), 'server/demoAccounts.js'))});
    const { BROWSER_STORE_KEY } = await import(${JSON.stringify(path.join(process.cwd(), 'server/persist.js'))});
    await seedDemo(db);
    const query = new URLSearchParams();
    const pub = await dispatch({ method: 'GET', path: '/api/demo', query, body: {}, token: '' });
    if (JSON.stringify(pub.json).includes(DEMO_PASSWORD)) throw new Error('password was published');
    if (pub.json.accounts.length !== 4) throw new Error('expected four demo people');
    const maya = await dispatch({ method: 'POST', path: '/api/demo/view', query, body: { email: 'maya.demo@taskspeck.test' }, token: '' });
    if (maya.json.user.name !== 'Maya Chen' || !maya.tokenSet) throw new Error('did not open as Maya');
    const me = await dispatch({ method: 'GET', path: '/api/auth/me', query, body: {}, token: maya.tokenSet });
    if (!me.json.tasks.some((task) => /Assemble a desk/.test(task.title || ''))) throw new Error('sample tasks missing');
    const user = db.userFromToken(maya.tokenSet);
    const licensed = db.upsertListingText('Rewire the kitchen power points', null, user);
    const blocked = await db.publishListing(licensed.task.id, { text: 'Rewire the kitchen power points', title: 'Rewire', cat: 'home', priceNum: 80 }, user);
    if (!blocked.error || !/licensed/i.test(blocked.error)) throw new Error('licensed work was allowed');
    const paint = db.upsertListingText('Paint two bedrooms, ground floor only', null, user);
    const over = await db.publishListing(paint.task.id, { text: 'Paint two bedrooms, ground floor only', title: 'Paint', cat: 'painting', priceNum: 12000 }, user);
    if (!over.error || !/registered builder/i.test(over.error)) throw new Error('building limit missing');
    const casey = await dispatch({ method: 'POST', path: '/api/demo/view', query, body: { email: 'casey.demo@taskspeck.test' }, token: maya.tokenSet });
    if (casey.json.user.launch.open !== false) throw new Error('Casey should be outside the 10 km zone');
    if (!mem.get(BROWSER_STORE_KEY)) throw new Error('demo data was not saved on this phone');
    mem.delete(BROWSER_STORE_KEY);
    mem.delete('taskspeck-demo-token');
    if (mem.has(BROWSER_STORE_KEY)) throw new Error('reset did not clear the saved demo');
    console.log('pages-demo-ok');
  `;
  const run = spawnSync(process.execPath, ['--input-type=module', '-e', script], { encoding: 'utf8' });
  assert.equal(run.status, 0, run.stderr || run.stdout);
  assert.match(run.stdout, /pages-demo-ok/);
});
