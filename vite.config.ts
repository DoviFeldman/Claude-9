import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';

const require = createRequire(import.meta.url);

/**
 * Serve the OCR language data from node_modules under a stable URL
 * (/tessdata/eng.traineddata.gz) — tesseract.js requires that exact file name,
 * so it can't go through Vite's hashed-asset pipeline. Dev serves it directly;
 * build copies it into dist. Keeps OCR fully local, no CDN.
 */
function tessdata(): Plugin {
  const file = () => readFileSync(
    require.resolve('@tesseract.js-data/eng/4.0.0_best_int/eng.traineddata.gz'),
  );
  return {
    name: 'tessdata',
    configureServer(server) {
      server.middlewares.use('/tessdata/eng.traineddata.gz', (_req, res) => {
        res.setHeader('Content-Type', 'application/gzip');
        res.end(file());
      });
    },
    generateBundle() {
      this.emitFile({ type: 'asset', fileName: 'tessdata/eng.traineddata.gz', source: file() });
    },
  };
}

export default defineConfig({
  plugins: [react(), tessdata()],
  resolve: {
    // piexif-ts declares a "module" entry that isn't shipped in the package
    alias: { 'piexif-ts': require.resolve('piexif-ts/dist/piexif.js') },
  },
  build: { target: 'es2022', chunkSizeWarningLimit: 2500 },
  optimizeDeps: { esbuildOptions: { target: 'es2022' } },
});
