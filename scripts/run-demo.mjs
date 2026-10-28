import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
process.chdir(root);
const demoDir = path.join(root, 'data', 'demo');
if (process.env.TASKSPECK_E2E === '1') {
  const data = path.resolve(process.env.TASKSPECK_DATA || '');
  const insideRepoData = data.startsWith(path.resolve(root, 'data') + path.sep);
  if (!data || insideRepoData) {
    throw new Error('Click-through tests must set TASKSPECK_DATA to a temp directory outside data/.');
  }
} else {
  process.env.TASKSPECK_DATA = demoDir;
}
process.env.TASKSPECK_DEMO = '1';
process.env.TASKSPECK_SYNC_SAVE = '1';
process.env.NOTIFY_PROVIDER = process.env.NOTIFY_PROVIDER || 'log';
process.env.NOTIFY_LOG_FILE = process.env.NOTIFY_LOG_FILE || path.join(process.env.TASKSPECK_DATA, 'notifications.log');
if (!process.env.TASKSPECK_HOST) process.env.TASKSPECK_HOST = '0.0.0.0';
if (!process.env.TASKSPECK_PORT) process.env.TASKSPECK_PORT = '5173';

const db = await import('../server/db.js');
const { seedDemo } = await import('../server/seedDemo.js');
await seedDemo(db);

const port = Number(process.env.TASKSPECK_PORT);
const urls = [`http://127.0.0.1:${port}/`];
for (const entries of Object.values(os.networkInterfaces())) {
  for (const entry of entries || []) {
    const v4 = entry.family === 'IPv4' || entry.family === 4;
    if (v4 && !entry.internal) urls.push(`http://${entry.address}:${port}/`);
  }
}
console.log('\nTaskSpeck demo');
console.log('Opens as Maya. Use Viewing as to switch to Sam, Priya, or Casey.');
console.log('No real money moves.');
for (const url of urls) console.log('Open ' + url);
if (urls.length > 1) console.log('On a phone on the same Wi-Fi, use an address that is not 127.0.0.1.');
console.log('');

const server = await createServer({
  root,
  server: { host: process.env.TASKSPECK_HOST, port, strictPort: true },
});
await server.listen();
server.printUrls();
