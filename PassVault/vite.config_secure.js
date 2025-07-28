import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Security-hardened Vite configuration for zero-knowledge password manager
export default defineConfig({
  plugins: [
    react({
      // Optimize React for production
      babel: {
        plugins: [
          // Remove development helpers
          ['transform-remove-console', { exclude: ['error', 'warn'] }],
        ],
      },
    }),
    tailwindcss(),
    {
      name: 'security-headers',
      configureServer(server) {
        server.middlewares.use((req, res, next) => {
          // Security headers for development
          res.setHeader('X-Content-Type-Options', 'nosniff');
          res.setHeader('X-Frame-Options', 'DENY');
          res.setHeader('X-XSS-Protection', '1; mode=block');
          res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
          next();
        });
      },
    }
  ],
  
  base: './', // Extension-compatible relative paths
  
  define: {
    // Security-focused environment variables
    'process.env.NODE_ENV': JSON.stringify(process.env.NODE_ENV || 'production'),
    '__DEV__': process.env.NODE_ENV !== 'production',
    '__EXTENSION_VERSION__': JSON.stringify(process.env.npm_package_version || '1.0.0'),
  },
  
  build: {
    // Security and performance optimization
    target: 'es2022',
    minify: 'terser',
    sourcemap: false, // No source maps in production for security
    
    terserOptions: {
      compress: {
        drop_console: true,
        drop_debugger: true,
        pure_funcs: ['console.log', 'console.debug'],
      },
      mangle: {
        toplevel: true,
        safari10: true,
      },
      output: {
        comments: false,
      },
    },
    
    rollupOptions: {
      input: {
        popup: resolve(__dirname, 'index.html'),
        background: resolve(__dirname, 'src/background/index_secure.js'),
        content: resolve(__dirname, 'src/content/index_secure.js'),
      },
      
      output: {
        entryFileNames: '[name].js',
        chunkFileNames: 'chunks/[name]-[hash].js',
        assetFileNames: 'assets/[name]-[hash].[ext]',
        
        // Ensure proper module format for extension contexts
        format: 'es',
        
        // Security: no dynamic imports that could bypass CSP
        manualChunks: undefined,
        
        // Minimize bundle size
        compact: true,
      },
      
      external: [
        // Use native browser APIs instead of polyfills
        'crypto',
        'chrome-extension://*',
      ],
    },
    
    // Extension-specific optimizations
    chunkSizeWarningLimit: 1000, // 1MB chunks max for extensions
    assetsInlineLimit: 4096, // 4KB inline limit
    
    // Ensure clean builds
    emptyOutDir: true,
  },
  
  // Development server configuration
  server: {
    port: 3000,
    strictPort: true,
    https: false, // Extensions don't need HTTPS in development
    open: false, // Don't auto-open browser
  },
  
  // Dependency optimization for faster builds
  optimizeDeps: {
    include: [
      'react',
      'react-dom',
    ],
    exclude: [
      // Exclude extension APIs from optimization
      'chrome',
    ],
  },
  
  // Path resolution for clean imports
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src'),
      '@components': resolve(__dirname, 'src/components'),
      '@utils': resolve(__dirname, 'src/utils'),
      '@vault': resolve(__dirname, 'vault'),
    },
  }
});