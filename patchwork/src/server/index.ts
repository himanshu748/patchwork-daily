import { Hono } from 'hono';
import { serve } from '@hono/node-server';
import { createServer, getServerPort } from '@devvit/web/server';
import { telemetryRoutes } from './routes/telemetry';

const app = new Hono();

app.route('/api/telemetry', telemetryRoutes);

serve({
  fetch: app.fetch,
  createServer,
  port: getServerPort(),
});
