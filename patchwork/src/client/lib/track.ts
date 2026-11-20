import { telemetry } from '@devvit/analytics/client/reddit';
import { validateEvent } from '../../shared/analytics';
import type { AnalyticsEvent, AnalyticsProps } from '../../shared/analytics';

export const TRACK_TIMEOUT_MS = 2000;

function details(props: AnalyticsProps): string {
  return Object.entries(props)
    .map(([k, v]) => `${k}=${String(v)}`)
    .join(';');
}

function send(name: AnalyticsEvent, props: AnalyticsProps): Promise<unknown> {
  switch (name) {
    case 'post_view':
      return telemetry.appReady();
    case 'first_interaction':
      return telemetry.startJourney();
    case 'tile_solved':
      // Journey.End without `game`: the score is not an allowed analytics property (Req 24.6).
      return telemetry.endJourney({ complete: true });
    default: {
      const text = details(props);
      return telemetry.interaction(text ? { action: name, actionDetails: text } : { action: name });
    }
  }
}

/**
 * The only analytics call site (Req 24.1). Drops events that fail validation, never throws, and lets no
 * rejection escape; a call slower than 2 s is abandoned (Req 24.5).
 */
export function track(eventName: string, properties: Readonly<Record<string, unknown>>): void {
  try {
    const event = validateEvent(eventName, properties);
    if (!event) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<void>((resolve) => {
      timer = setTimeout(resolve, TRACK_TIMEOUT_MS);
    });
    const call = Promise.resolve()
      .then(() => send(event.name, event.props))
      .then(
        () => undefined,
        () => console.warn(`Analytics event ${event.name} dropped`),
      );
    void Promise.race([call, timeout]).finally(() => clearTimeout(timer));
  } catch {
    // Analytics never affects play.
  }
}
