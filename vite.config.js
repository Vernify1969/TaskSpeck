import { defineConfig } from 'vite';
import { taskApiPlugin } from './server/viteApiPlugin.js';

const host = process.env.TASKSPECK_HOST || '127.0.0.1';
const port = Number(process.env.TASKSPECK_PORT || 5173);

export default defineConfig({
  root: '.',
  plugins: [taskApiPlugin()],
  server: {
    host,
    port,
    strictPort: true,
  },
});
