import { defineConfig } from 'vite';
import path from 'path';

export default defineConfig({
  root: './',
  publicDir: 'public',
  resolve: {
    alias: {
      '@engine': path.resolve(__dirname, 'packages/engine')
    }
  },
  server: {
    port: 5173,
    open: false,
    host: true
  },
  assetsInclude: ['**/*.mesh', '**/*.jpg', '**/*.png', '**/*.mp3', '**/*.json']
});
