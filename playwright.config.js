import path from 'node:path';
import { defineConfig } from '@playwright/test';

const dataDir = path.join(process.cwd(), 'data', 'e2e');

export default defineConfig({
  testDir: 'e2e',
  timeout: 120000,
  expect: { timeout: 15000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  use: {
    baseURL: 'http://127.0.0.1:5174',
    channel: 'chrome',
    headless: true,
    launchOptions: { args: ['--no-sandbox', '--disable-dev-shm-usage'] },
    trace: 'retain-on-failure',
  },
  webServer: {
    command: 'node scripts/run-demo.mjs',
    url: 'http://127.0.0.1:5174/api/health',
    reuseExistingServer: false,
    timeout: 120000,
    env: {
      ...process.env,
      TASKSPECK_DEMO: '1',
      TASKSPECK_HOST: '127.0.0.1',
      TASKSPECK_PORT: '5174',
      TASKSPECK_DATA: dataDir,
      TASKSPECK_SYNC_SAVE: '1',
      NOTIFY_PROVIDER: 'log',
    },
  },
});
