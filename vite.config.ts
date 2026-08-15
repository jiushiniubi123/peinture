import path from 'path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
    server: {
      port: 3000,
      host: '0.0.0.0',
      watch: {
        // Keep the watcher count low in sandboxed environments: ignore the
        // pnpm store and node_modules which contain tens of thousands of files.
        ignored: ['**/.pnpm-store/**', '**/node_modules/**'],
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
