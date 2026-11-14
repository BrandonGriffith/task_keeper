import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  build: {
    outDir: '../build',
    emptyOutDir: true,
  },
  server: {
    host: process.env.HOST || '0.0.0.0',
    proxy: {
      '/api': 'http://localhost:3001',
    },
  },
});
