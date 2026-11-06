import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

test('local data layer stores on this phone and hides contact until booking', () => {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
  const res = spawnSync(process.execPath, ['client/data/localData.check.mjs'], {
    cwd: root,
    encoding: 'utf8',
    env: { ...process.env, TASKSPECK_DEMO: '0', TASKSPECK_DATA: '' },
  });
  if (res.status !== 0) {
    throw new Error(res.stderr || res.stdout || `local data layer check exited ${res.status}`);
  }
});
