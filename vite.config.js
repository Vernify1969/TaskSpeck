import path from 'path';
import { fileURLToPath } from 'url';
import { defineConfig, loadEnv } from 'vite';
import { taskApiPlugin } from './server/viteApiPlugin.js';

const root = fileURLToPath(new URL('.', import.meta.url));

export default defineConfig(({ command, mode }) => {
  const env = loadEnv(mode, root, '');
  const pages = process.env.TASKSPECK_PAGES === '1';
  const localApi = command === 'build' && (env.VITE_LOCAL_API === '1' || process.env.VITE_LOCAL_API === '1');
  const host = process.env.TASKSPECK_HOST || '127.0.0.1';
  const port = Number(process.env.TASKSPECK_PORT || 5173);
  return {
    root: '.',
    base: pages ? '/TaskSpeck/' : '/',
    // The browser bundle freezes process.env at build time, so the phone demo
    // cannot switch these on later. Node tests and `npm run dev` do not use this.
    define: localApi ? {
      'process.env.TASKSPECK_DEMO': JSON.stringify('1'),
      'process.env.TASKSPECK_SYNC_SAVE': JSON.stringify('1'),
      'process.env.NOTIFY_PROVIDER': JSON.stringify('log'),
      'process.env.LAUNCH_EXTRA_SUBURBS': JSON.stringify(''),
    } : undefined,
    plugins: [
      taskApiPlugin(),
      {
        name: 'pages-only-local-api',
        resolveId(id) {
          if (localApi) return null;
          if (id.includes('client/localApi.js')) return '\0local-api-stub';
          return null;
        },
        load(id) {
          if (id !== '\0local-api-stub') return null;
          return 'export async function installLocalApi(){}\nexport function resetDemoData(){ location.reload(); }\n';
        },
      },
    ],
    resolve: localApi ? {
      alias: [
        { find: 'node:fs', replacement: path.join(root, 'client/shims/fs.js') },
        { find: 'fs', replacement: path.join(root, 'client/shims/fs.js') },
        { find: 'node:path', replacement: path.join(root, 'client/shims/path.js') },
        { find: 'path', replacement: path.join(root, 'client/shims/path.js') },
        { find: 'node:crypto', replacement: path.join(root, 'client/shims/crypto.js') },
        { find: 'crypto', replacement: path.join(root, 'client/shims/crypto.js') },
      ],
    } : undefined,
    server: { host, port, strictPort: true },
    preview: { host: '127.0.0.1', port: 5199, strictPort: true },
  };
});
