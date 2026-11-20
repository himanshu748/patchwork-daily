import type { ClientErrorCode } from '../../shared/api';

/** Player-facing texts; every string matches design.md "Screens" and "Server error codes". */
export const TEXT = {
  assignFailed: 'Could not get a tile.',
  notPatchwork: 'This post is not a Patchwork puzzle.',
  submitFailed: 'Your solve did not go through.',
  mosaicChanged: "Today's mosaic changed.",
  rejected: 'Not the stored answer yet.',
  loginToStitch: 'Log in to stitch this tile.',
  firstStitch: 'Be the first stitch today',
  notEnoughSolves: 'Not enough solves yet to compare. Check back later.',
  percentileUnavailable: 'Percentile not available yet.',
  rankingUnavailable: 'Ranking is temporarily unavailable.',
  extraFailed: 'No extra tile could be assigned. Try again.',
  commentPosted: 'Comment posted.',
  commentFailed: 'Comment not posted. Try again.',
  scoreUnavailable: 'Score could not be computed for this solve.',
  dayEnded: 'This day ended before your solve, so it was not scored.',
  newPuzzle: 'A new puzzle is ready.',
  unavailable: 'Unavailable',
  somethingWrong: 'Something went wrong.',
} as const;

export type SubmitFailureAction = 'retry' | 'new-tile' | 'login';

/** What the Play_Screen shows for a failed `/api/submit`, by error code. */
export function submitFailure(code: ClientErrorCode): { readonly text: string; readonly action: SubmitFailureAction } {
  switch (code) {
    case 'AUTH_REQUIRED':
      return { text: TEXT.loginToStitch, action: 'login' };
    case 'MOSAIC_CHANGED':
      return { text: TEXT.mosaicChanged, action: 'new-tile' };
    case 'DAY_MISMATCH':
    case 'TILE_NOT_ASSIGNED':
    case 'INVALID_GRID':
      return { text: TEXT.submitFailed, action: 'new-tile' };
    default:
      return { text: TEXT.submitFailed, action: 'retry' };
  }
}

/** `/api/assign` errors worth one automatic retry after 1 s (design.md timeout matrix). */
export function assignRetryable(code: ClientErrorCode): boolean {
  return code === 'TIMEOUT' || code === 'NETWORK' || code === 'ASSIGN_FAILED' || code === 'DAY_NOT_READY';
}
