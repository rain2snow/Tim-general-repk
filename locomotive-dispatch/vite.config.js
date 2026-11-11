import { defineConfig } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';

// `npm run build` emits dist/index.html: one self-contained file (JS, CSS, data inlined),
// like the original hand-built dispatch.html, so it can be emailed / opened from disk.
export default defineConfig({
  plugins: [viteSingleFile()],
  build: { target: 'es2019', chunkSizeWarningLimit: 4000 },
  test: { include: ['tests/unit/**/*.test.js'], environment: 'node' },
});
