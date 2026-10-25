import { defineConfig } from 'vite';

export default defineConfig({
  base: process.env.BASE_PATH || '/',
  // Share generated WASM/runtime and branding assets, not the editor application.
  publicDir: '../editor/public',
  server: {fs: {deny: ['.env', '.env.*', '*.{crt,pem}', '**/.git/**', '**/.bal-bot/**']}},
});
