import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';

/**
 * Development only: lets a real audit, run in a Chrome that has the on-device model, be saved as
 * a recorded run (public/recorded/<sample>.json) for the honest "watch a recorded run" replay.
 */
function saveRecordedRuns(): Plugin {
  return {
    name: 'save-recorded-runs',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use('/__save-run', (req, res) => {
        if (req.method !== 'POST') { res.statusCode = 405; res.end(); return; }
        let body = '';
        req.on('data', c => { body += c; });
        req.on('end', () => {
          try {
            const run = JSON.parse(body) as { meta?: { sample?: string } };
            const id = run.meta?.sample ?? '';
            if (!/^[a-z]+$/.test(id)) throw new Error('bad sample id');
            const dir = join(server.config.root, 'public', 'recorded');
            mkdirSync(dir, { recursive: true });
            writeFileSync(join(dir, `${id}.json`), JSON.stringify(run));
            res.end(`saved ${id}`);
          } catch (e) {
            res.statusCode = 400;
            res.end((e as Error).message);
          }
        });
      });
    },
  };
}

export default defineConfig({
  plugins: [react(), saveRecordedRuns()],
  server: { port: 5173, strictPort: true },
  build: { target: 'es2022', sourcemap: true },
});
