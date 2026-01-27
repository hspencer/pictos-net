import path from 'path';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import wasm from 'vite-plugin-wasm';
import topLevelAwait from 'vite-plugin-top-level-await';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, '.', '');
  return {
    // GitHub Pages with custom domain: use root path
    base: '/',
    server: {
      port: 3000,
      host: '0.0.0.0',
    },
    plugins: [
      react(),
      wasm(),
      topLevelAwait()
    ],
    // SECURITY WARNING: These API keys are being exposed to client-side code
    // and will be visible in the browser. For production environments,
    // consider implementing a backend proxy to handle API calls securely.
    define: {
      'process.env.API_KEY': JSON.stringify(env.GEMINI_API_KEY),
      'process.env.GEMINI_API_KEY': JSON.stringify(env.GEMINI_API_KEY)
    },
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      }
    },
    // Exclude vector tracer from optimizations if needed, though plugins should handle it
    optimizeDeps: {
      exclude: ['vectortracer']
    }
  };
});
