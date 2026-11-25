import { Hono } from 'hono';
import type { Context } from 'hono';
import { context } from '@devvit/web/server';
import type { SettingsValidationResponse, UiResponse } from '@devvit/web/shared';
import type { DayKey } from '../../shared/daykey';
import { dayKeyFromMs, parseDayKey } from '../../shared/daykey';
import { ensureDailyPost, onInstall, runTick } from '../core/daily';
import { readMeta, recordInstallDate } from '../core/day';
import { switchGeneration } from '../core/generation';
import { isModerator, ModCheckFailed } from '../core/mod';
import { refreshPreview, sendSnapshot } from '../core/preview';

export const START_DATE_ERROR = 'Use a real date as yyyy-mm-dd';
export const MOD_REQUIRED_TEXT = 'Moderator permission is required.';
export const MOD_CHECK_FAILED_TEXT = 'Could not check moderator permission. Try again.';
export const NO_REVIEWS_TEXT = 'No mosaics waiting for review.';

function reason(error: unknown): string {
  return error instanceof Error ? error.message : 'unknown error';
}

async function readBody(c: Context): Promise<Record<string, unknown>> {
  try {
    const body: unknown = await c.req.json();
    return typeof body === 'object' && body !== null ? (body as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

function toast(c: Context, text: string, success = false): Response {
  return c.json<UiResponse>({ showToast: success ? { text, appearance: 'success' } : text });
}

/** Every moderator action re-checks permission on the Server and fails closed (Req 21.6, Req 22.5, Decision D23). */
async function modGate(c: Context): Promise<Response | null> {
  try {
    if (await isModerator(context.userId)) return null;
    return toast(c, MOD_REQUIRED_TEXT);
  } catch (error) {
    if (!(error instanceof ModCheckFailed)) throw error;
    console.warn('moderator check failed', reason(error));
    return toast(c, MOD_CHECK_FAILED_TEXT);
  }
}

export const internalRoutes = new Hono();

internalRoutes.post('/scheduler/daily-post', async (c) => {
  const nowMs = Date.now();
  const d = dayKeyFromMs(nowMs);
  try {
    console.log('daily-post', d, await ensureDailyPost(d, 'cron', nowMs));
  } catch (error) {
    console.warn('daily-post failed', d, reason(error));
  }
  return c.json({});
});

internalRoutes.post('/scheduler/tick', async (c) => {
  try {
    await runTick(Date.now());
  } catch (error) {
    console.warn('tick failed', reason(error));
  }
  return c.json({});
});

internalRoutes.post('/triggers/on-app-install', async (c) => {
  try {
    console.log('install', await onInstall(Date.now()));
  } catch (error) {
    console.warn('install trigger failed', reason(error));
  }
  return c.json({});
});

internalRoutes.post('/triggers/on-app-upgrade', async (c) => {
  try {
    await recordInstallDate(Date.now());
  } catch (error) {
    console.warn('upgrade trigger failed', reason(error));
  }
  return c.json({});
});

type Mode = 'regenerate' | 'skip';

const CONFIRM: Record<Mode, { readonly form: string; readonly title: string; readonly description: string; readonly label: string; readonly accept: string }> = {
  regenerate: {
    form: 'regenerateConfirm',
    title: "Regenerate today's mosaic",
    description: 'Today\'s mosaic gets a new variant of the same motif. Stitches so far stay recorded for the old one.',
    label: "Yes, replace today's mosaic",
    accept: 'Regenerate',
  },
  skip: {
    form: 'skipConfirm',
    title: "Skip today's mosaic",
    description: 'Today\'s mosaic switches to the next motif. Stitches so far stay recorded for the old one.',
    label: "Yes, use the next motif today",
    accept: 'Skip',
  },
};

function confirmForm(c: Context, mode: Mode): Response {
  const spec = CONFIRM[mode];
  return c.json<UiResponse>({
    showForm: {
      name: spec.form,
      form: {
        title: spec.title,
        description: spec.description,
        acceptLabel: spec.accept,
        cancelLabel: 'Cancel',
        fields: [{ name: 'confirm', label: spec.label, type: 'boolean', defaultValue: false }],
      },
    },
  });
}

for (const mode of ['regenerate', 'skip'] as const) {
  internalRoutes.post(`/menu/${mode}`, async (c) => (await modGate(c)) ?? confirmForm(c, mode));

  internalRoutes.post(`/form/${mode}`, async (c) => {
    const gate = await modGate(c);
    if (gate) return gate;
    const body = await readBody(c);
    if (body.confirm !== true) return toast(c, 'Nothing changed. Tick the box to confirm.');
    const nowMs = Date.now();
    const d: DayKey = dayKeyFromMs(nowMs);
    const failed = `${mode === 'regenerate' ? 'Regenerate' : 'Skip'} failed. Today's mosaic is unchanged.`;
    try {
      if (!(await readMeta(d))?.postId) {
        // A Day_Key without a post runs the creation sequence instead (Decision D21).
        const outcome = await ensureDailyPost(d, 'moderator', nowMs);
        if (outcome === 'created' || outcome === 'exists') return toast(c, `Posted today's mosaic for ${d}.`, true);
        return toast(c, outcome === 'before-start' ? `Patchwork starts after ${d}; nothing posted.` : failed);
      }
      const res = await switchGeneration(d, mode);
      await refreshPreview(d);
      await sendSnapshot(d);
      const verb = mode === 'regenerate' ? 'Regenerated' : 'Skipped to';
      return toast(c, `${verb} ${res.motifName} for ${d}.`, true);
    } catch (error) {
      console.warn(`${mode} failed`, d, reason(error));
      return toast(c, failed);
    }
  });
}

// The UGC_Queue arrives in work step 6; until then the review entry points answer with the empty state.
internalRoutes.post('/menu/review', async (c) => (await modGate(c)) ?? toast(c, NO_REVIEWS_TEXT));
internalRoutes.post('/form/review', async (c) => (await modGate(c)) ?? toast(c, NO_REVIEWS_TEXT));

internalRoutes.post('/settings/validate-start-date', async (c) => {
  const body = await readBody(c);
  const value = typeof body.value === 'string' ? body.value.trim() : body.value;
  const valid = value === undefined || value === null || value === '' || (typeof value === 'string' && parseDayKey(value) !== null);
  return c.json<SettingsValidationResponse>(valid ? { success: true } : { success: false, error: START_DATE_ERROR });
});
