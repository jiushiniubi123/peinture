import path from 'path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
    server: {
      port: 3000,
      host: '0.0.0.0',
      // Dev-mode proxy for /ms-proxy -> ModelScope, mirroring
      // server/proxy-server.mjs so VITE_MS_PROXY_URL=/ms-proxy works with `npm run dev`.
      proxy: {
        '/ms-proxy': {
          target: 'https://api-inference.modelscope.cn',
          changeOrigin: true,
          rewrite: (path) => path.replace(/^\/ms-proxy/, ''),
          configure: (proxy) => {
            proxy.on('proxyReq', (proxyReq) => {
              // Allow X-ModelScope-Task-Type through (needed for task polling)
              proxyReq.setHeader('X-ModelScope-Task-Type', 'image_generation');
            });
          },
        },
      },
    },
    base: './',
    plugins: [react()],

    envPrefix: 'VITE_',
    envDir: '.',

    build: {
      target: 'es2022',
      sourcemap: false,
      rollupOptions: {
        output: {
          manualChunks: {
            'vendor-react': ['react', 'react-dom'],
            'vendor-ui': ['sonner', 'lucide-react', 'react-zoom-pan-pinch'],
            'vendor-store': ['zustand'],
          },
        },
      },
    },

    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      }
    }
});
