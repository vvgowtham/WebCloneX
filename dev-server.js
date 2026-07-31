// Local dev server: serves Vite frontend + Vercel-style API routes
// Usage: node --env-file=.env dev-server.js
import express from 'express';
import cors from 'cors';
import { createServer as createViteServer } from 'vite';

const app = express();
app.use(cors());
app.use(express.json());

// ── API routes (mirrors Vercel /api directory) ──────────────────────
app.all('/api/clone', async (req, res) => {
  const { default: handler } = await import('./api/clone.js');
  return handler(req, res);
});

app.all('/api/catalog', async (req, res) => {
  const { default: handler } = await import('./api/catalog.js');
  return handler(req, res);
});

app.all('/api/jobs', async (req, res) => {
  const { default: handler } = await import('./api/jobs.js');
  return handler(req, res);
});

app.all('/api/proxy', async (req, res) => {
  const { default: handler } = await import('./api/proxy.js');
  return handler(req, res);
});

// ── Vite dev server as middleware ───────────────────────────────────
const vite = await createViteServer({
  server: { middlewareMode: true },
  appType: 'spa',
});
app.use(vite.middlewares);

const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`\n  🚀 Dev server running at http://localhost:${port}\n`);
  console.log(`  Frontend: Vite (HMR enabled)`);
  console.log(`  API:      /api/clone, /api/catalog, /api/jobs, /api/proxy\n`);
});
