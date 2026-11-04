import fs from 'fs';
import path from 'path';

export const BROWSER_STORE_KEY = 'taskspeck-demo-v1';

function inBrowser() {
  return typeof localStorage !== 'undefined';
}

function dataDir() {
  return process.env.TASKSPECK_DATA || path.join(process.cwd(), 'data');
}

function storeFile() {
  return path.join(dataDir(), 'store.json');
}

function legacyFile() {
  return path.join(dataDir(), 'tasks.json');
}

export function readStoreFile() {
  if (inBrowser()) {
    const raw = localStorage.getItem(BROWSER_STORE_KEY);
    return raw ? JSON.parse(raw) : null;
  }
  if (!fs.existsSync(storeFile())) return null;
  return JSON.parse(fs.readFileSync(storeFile(), 'utf8'));
}

export function writeStoreFile(data) {
  const text = JSON.stringify(data, null, inBrowser() ? 0 : 2);
  if (inBrowser()) {
    localStorage.setItem(BROWSER_STORE_KEY, text);
    return;
  }
  fs.mkdirSync(dataDir(), { recursive: true });
  fs.writeFileSync(storeFile(), text);
}

export function readLegacyTasks() {
  if (inBrowser()) return null;
  if (!fs.existsSync(legacyFile())) return null;
  return JSON.parse(fs.readFileSync(legacyFile(), 'utf8'));
}
