import { defineConfig } from 'vite';
import { taskApiPlugin } from './server/viteApiPlugin.js';

export default defineConfig({
  root: '.',
  plugins: [taskApiPlugin()],
  server: {
    port: 5173,
    open: true,
  },
});
