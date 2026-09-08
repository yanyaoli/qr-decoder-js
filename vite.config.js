import { defineConfig } from 'vite';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = fileURLToPath(new URL('.', import.meta.url));

export default defineConfig({
    build: {
    outDir: 'dist',
    emptyOutDir: true,
    lib: {
      entry: resolve(rootDir, 'src/index.js'),
      name: 'QRDecoder',
      formats: ['es', 'umd'],
      fileName: (format) => (format === 'es' ? 'qr-decoder.js' : 'qr-decoder.umd.cjs'),
    },
    rollupOptions: {
      // Keep binary resources (e.g. wasm) in assets/ without content hashes so they
      // can be located by the runtime loader.
      output: {
        assetFileNames: (assetInfo) => {
          const name = assetInfo.name || '';
          if (/\.wasm$/i.test(name)) return 'assets/[name][extname]';
          return 'assets/[name]-[hash][extname]';
        },
      },
    },
  },
  assetsInclude: ['**/*.wasm'],
});
