import type { AssignResponse, ClientResult } from '../../shared/api';
import { apiPost } from '../lib/api';
import { assignRetryable } from '../lib/messages';

export const ASSIGN_TIMEOUT_MS = 8000;
const ASSIGN_RETRY_DELAY_MS = 1000;

/** One automatic retry after 1 s for TIMEOUT, NETWORK, ASSIGN_FAILED and DAY_NOT_READY. */
export async function requestAssign(): Promise<ClientResult<AssignResponse>> {
  const first = await apiPost<AssignResponse>('/api/assign', {}, ASSIGN_TIMEOUT_MS);
  if (first.ok || !assignRetryable(first.code)) return first;
  await new Promise((resolve) => setTimeout(resolve, ASSIGN_RETRY_DELAY_MS));
  return apiPost<AssignResponse>('/api/assign', {}, ASSIGN_TIMEOUT_MS);
}

/**
 * Started while the game entry's first module evaluates, before React renders, so the Clues are
 * usually in memory when the Play_Screen mounts (Req 10.1, Req 27.2).
 */
export const initialAssign: Promise<ClientResult<AssignResponse>> = requestAssign();
