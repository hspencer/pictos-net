import path from 'path';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, '.', '');
  return {
    // GitHub Pages with custom domain: use root path
    base: '/',
    server: {
      port: 3000,
      host: '0.0.0.0',
      proxy: {
        '/.netlify': {
          target: 'http://localhost:9001',
          changeOrigin: true,
        },
      },
    },
    plugins: [
      react(),
    ],
    // All AI calls go through Netlify Functions in both dev and prod.
    // Use `netlify dev` locally — no API key ever reaches the browser.
    define: {},
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
        '@style-editor': path.resolve(__dirname, './lib/style-editor'),
        '@schema': path.resolve(__dirname, './schemas/mf-svg-schema')
      }
    },
    build: {
      sourcemap: mode === 'development',
    },
    optimizeDeps: {
      exclude: []
    }
  };
});
