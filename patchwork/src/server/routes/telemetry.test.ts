import { beforeEach, describe, expect, it, vi } from 'vitest';
import { telemetryRoutes } from './telemetry';

const calls = vi.hoisted(() => ({ list: [] as { method: string; arg: unknown }[], journeyId: 'j1' }));

vi.mock('@devvit/analytics/server/reddit', () => {
  const receipt = { status: 'JOURNEY_RECEIPT_DENIED_PLAYTEST', message: '' };
  const record = (method: string) => async (arg?: unknown) => {
    calls.list.push({ method, arg });
    return method === 'startJourney' ? { journeyId: calls.journeyId, receipt } : { receipt };
  };
  return {
    telemetry: {
      appReady: record('appReady'),
      startJourney: record('startJourney'),
      journeyInteraction: record('journeyInteraction'),
      endJourney: record('endJourney'),
    },
  };
});

function post(path: string, body?: unknown): Promise<Response> {
  return Promise.resolve(
    telemetryRoutes.request(path, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    }),
  );
}

describe('telemetry routes', () => {
  beforeEach(() => {
    calls.list.length = 0;
    calls.journeyId = 'j1';
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  });

  it('forwards the four journey calls the client makes', async () => {
    expect((await post('/journey/app-ready')).status).toBe(200);
    const start = await post('/journey/start');
    expect(await start.json()).toMatchObject({ journeyId: 'j1' });
    expect((await post('/journey/interaction', { journeyId: 'j1', action: 'tile_assigned', actionDetails: 'tileIndex=3' })).status).toBe(200);
    expect((await post('/journey/interaction', { action: 'share_comment' })).status).toBe(200);
    expect((await post('/journey/end', { journeyId: 'j1', complete: true })).status).toBe(200);
    expect(calls.list).toEqual([
      { method: 'appReady', arg: undefined },
      { method: 'startJourney', arg: undefined },
      { method: 'journeyInteraction', arg: { journeyId: 'j1', action: 'tile_assigned', actionDetails: 'tileIndex=3' } },
      { method: 'journeyInteraction', arg: { journeyId: '', action: 'share_comment', actionDetails: '' } },
      { method: 'endJourney', arg: { journeyId: 'j1', complete: true } },
    ]);
  });

  it('rejects the bodies the package router rejects', async () => {
    const bad: [string, unknown][] = [
      ['/journey/interaction', {}],
      ['/journey/interaction', { action: 'x', journeyId: 5 }],
      ['/journey/interaction', { action: 'x', actionDetails: '' }],
      ['/journey/end', { complete: true }],
      ['/journey/end', { journeyId: 'j1', complete: 'yes' }],
    ];
    for (const [path, body] of bad) expect((await post(path, body)).status, JSON.stringify(body)).toBe(400);
    expect(calls.list).toEqual([]);
  });

  it('answers 500 without throwing when no journey id comes back', async () => {
    calls.journeyId = '';
    expect((await post('/journey/start')).status).toBe(500);
  });
});
