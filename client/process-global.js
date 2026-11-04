const demoEnv = {
  TASKSPECK_DEMO: '1',
  TASKSPECK_SYNC_SAVE: '1',
  NOTIFY_PROVIDER: 'log',
  LAUNCH_EXTRA_SUBURBS: '',
};

if (typeof globalThis.process === 'undefined') {
  globalThis.process = { env: { ...demoEnv } };
} else if (globalThis.process.env) {
  Object.assign(globalThis.process.env, demoEnv, globalThis.process.env);
}
if (typeof globalThis.process.cwd !== 'function') {
  globalThis.process.cwd = () => '/';
}
