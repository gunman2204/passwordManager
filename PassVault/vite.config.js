import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { crx } from '@crxjs/vite-plugin';
import wasm from 'vite-plugin-wasm';
import topLevelAwait from 'vite-plugin-top-level-await';
import manifest from './src/manifest.json';

// CRXJS-optimized Vite configuration for PassVault
export default defineConfig({
  plugins: [
    wasm(),
    topLevelAwait(),
    react(),
    tailwindcss(),
    crx({
      manifest,
      contentScripts: {
        injectCss: true,
      },
    }),
  ],
  
  // Extension-specific build configuration
  build: {
    rollupOptions: {
      output: {
        chunkFileNames: 'assets/[name]-[hash].js',
        entryFileNames: 'assets/[name]-[hash].js',
        assetFileNames: 'assets/[name]-[hash].[ext]',
      },
    },
    // Optimize for extension size
    target: 'chrome102',
    minify: 'terser',
    sourcemap: process.env.NODE_ENV === 'development',
  },

  // Development server configuration
  server: {
    port: 5173,
    strictPort: true,
    hmr: {
      port: 5173,
    },
  },

  // Extension-specific optimizations
  define: {
    'process.env.NODE_ENV': JSON.stringify(process.env.NODE_ENV || 'development'),
    __DEV__: process.env.NODE_ENV !== 'production',
  },

  // WebAssembly and Worker configuration
  worker: {
    format: 'es',
    plugins: () => [wasm(), topLevelAwait()],
  },

  optimizeDeps: {
    exclude: ['@noble/hashes'],
    esbuildOptions: {
      target: 'es2020',
    },
  },

  // Resolve configuration for extension context
  resolve: {
    alias: {
      '@': new URL('./src', import.meta.url).pathname,
      '@components': new URL('./src/components', import.meta.url).pathname,
      '@utils': new URL('./src/utils', import.meta.url).pathname,
      '@vault': new URL('./vault', import.meta.url).pathname,
    },
  },
});
