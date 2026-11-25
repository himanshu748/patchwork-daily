import { Hono } from 'hono';
import { serve } from '@hono/node-server';
import { createServer, getServerPort } from '@devvit/web/server';
import { apiRoutes } from './routes/api';
import { internalRoutes } from './routes/internal';
import { telemetryRoutes } from './routes/telemetry';

const app = new Hono();

app.route('/api/telemetry', telemetryRoutes);
app.route('/api', apiRoutes);
app.route('/internal', internalRoutes);

app.onError((error, c) => {
  console.error('unexpected server error', c.req.path, error);
  return c.json({ ok: false, code: 'UNAVAILABLE', message: 'unexpected error', retry: true }, 500);
});

serve({
  fetch: app.fetch,
  createServer,
  port: getServerPort(),
});
