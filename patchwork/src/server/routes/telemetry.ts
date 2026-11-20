import { Hono } from 'hono';
import type { Context } from 'hono';
import { telemetry } from '@devvit/analytics/server/reddit';

/**
 * The Journeys endpoints the client `telemetry` object posts to (`/api/telemetry/journey/*`). The package's
 * `createTelemetryRouter()` returns an Express router, so this Hono app forwards the same requests to the
 * documented server `telemetry` client instead. Every handler answers; a failure never reaches gameplay.
 */
export const telemetryRoutes = new Hono();

type Body = Record<string, unknown>;

async function readBody(c: Context): Promise<Body> {
  try {
    const body: unknown = await c.req.json();
    return typeof body === 'object' && body !== null ? (body as Body) : {};
  } catch {
    return {};
  }
}

function text(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function nonEmpty(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function badRequest(c: Context, error: string): Response {
  console.warn('Journeys bad request:', error);
  return c.json({ error, receipt: { status: 'JOURNEY_RECEIPT_INVALID', message: 'Invalid: Event payload was not recorded.' } }, 400);
}

async function answer(c: Context, label: string, work: () => Promise<unknown>): Promise<Response> {
  try {
    return c.json(await work());
  } catch (error) {
    console.warn(`Journeys ${label} failed`, error instanceof Error ? error.message : 'unknown error');
    return c.json({ error: 'Telemetry unavailable', receipt: { status: 'JOURNEY_RECEIPT_UNSPECIFIED', message: '' } }, 500);
  }
}

telemetryRoutes.post('/journey/app-ready', (c) => answer(c, 'app-ready', () => telemetry.appReady()));

telemetryRoutes.post('/journey/start', (c) =>
  answer(c, 'start', async () => {
    const response = await telemetry.startJourney();
    if (!nonEmpty(response.journeyId)) throw new Error('Telemetry journey id missing');
    return response;
  }),
);

telemetryRoutes.post('/journey/interaction', async (c) => {
  const body = await readBody(c);
  const action = text(body.action);
  if (!nonEmpty(action)) return badRequest(c, 'action is required.');
  if (body.journeyId !== undefined && typeof body.journeyId !== 'string') return badRequest(c, 'journeyId must be a string.');
  if (body.actionDetails !== undefined && !nonEmpty(body.actionDetails)) return badRequest(c, 'actionDetails must be a non-empty string.');
  return answer(c, 'interaction', () =>
    telemetry.journeyInteraction({ journeyId: text(body.journeyId), action, actionDetails: text(body.actionDetails) }),
  );
});

telemetryRoutes.post('/journey/end', async (c) => {
  const body = await readBody(c);
  const journeyId = text(body.journeyId);
  if (!nonEmpty(journeyId)) return badRequest(c, 'journeyId is required.');
  if (body.complete !== undefined && typeof body.complete !== 'boolean') return badRequest(c, 'complete must be a boolean.');
  return answer(c, 'end', () => telemetry.endJourney({ journeyId, complete: body.complete === true }));
});
