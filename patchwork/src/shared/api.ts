import type { Clue } from './clues';
import type { TileSize } from './daykey';

/** Codes the Server sends in an ApiError; the Client picks player-facing text from the code. */
export type ErrorCode =
  | 'AUTH_REQUIRED'
  | 'NOT_A_PATCHWORK_POST'
  | 'DAY_NOT_READY'
  | 'DAY_MISMATCH'
  | 'MOSAIC_CHANGED'
  | 'TILE_NOT_ASSIGNED'
  | 'INVALID_GRID'
  | 'STITCH_NOT_SAVED'
  | 'ASSIGN_FAILED'
  | 'SCORED_FIRST'
  | 'NO_RESULT'
  | 'SHARE_FAILED'
  | 'STREAK_REQUIRED'
  | 'UGC_INVALID'
  | 'UGC_UNSOLVABLE'
  | 'VOTE_CLOSED'
  | 'ALREADY_VOTED'
  | 'NOT_IN_VOTE'
  | 'NOT_COMPLETE'
  | 'CREDITS_FAILED'
  | 'MOD_REQUIRED'
  | 'ALREADY_REVIEWED'
  | 'UGC_NOT_FOUND'
  | 'MOSAIC_UNAVAILABLE'
  /** A Redis failure on a route with no failure code of its own (end card, flair, ghost-seen). */
  | 'UNAVAILABLE';

export type UgcCheck = 'square' | 'size' | 'palette';

export type ApiError = {
  readonly ok: false;
  readonly code: ErrorCode;
  readonly message: string;
  readonly retry: boolean;
  readonly tileIndex?: number;
  readonly check?: UgcCheck;
};
export type ApiResult<T> = ({ readonly ok: true } & T) | ApiError;

/** NETWORK and TIMEOUT are produced by the Client's request helpers only, never by the Server. */
export type ClientErrorCode = ErrorCode | 'NETWORK' | 'TIMEOUT';
export type ClientError = Omit<ApiError, 'code'> & { readonly code: ClientErrorCode };
export type ClientResult<T> = ({ readonly ok: true } & T) | ClientError;

/** The only Tile shape sent before a Stitch: Clues, Tile_Size, Tile_Index and generation (Req 9.9). */
export type TileWire = {
  readonly gen: number;
  readonly index: number;
  readonly size: TileSize;
  readonly rowClues: readonly Clue[];
  readonly colClues: readonly Clue[];
};

export type AssignedTile = {
  readonly kind: 'scored' | 'late' | 'practice';
  readonly tile: TileWire;
  readonly dayKey: string;
  readonly dayNumber: number;
  readonly assignedAtMs: number;
  readonly serverNowMs: number;
  readonly firstInteraction: boolean;
  readonly showGhost: boolean;
  readonly showReview: boolean;
};
export type AssignDone = {
  readonly kind: 'scored-done';
  readonly tileIndex: number;
  readonly gen: number;
  readonly showReview: boolean;
};
export type AssignResponse = AssignedTile | AssignDone;

export type ExtraResponse =
  | {
      readonly kind: 'extra' | 'late';
      readonly tile: TileWire;
      readonly dayKey: string;
      readonly dayNumber: number;
      readonly assignedAtMs: number;
      readonly serverNowMs: number;
    }
  | { readonly kind: 'complete' };

export type SubmitRequest = {
  readonly dayKey: string;
  readonly gen: number;
  readonly tileIndex: number;
  /** encodeGrid output: n × n characters '0', '1', '2'. */
  readonly grid: string;
};

export type ResultWire = {
  readonly score: number;
  readonly solveMs: number;
  readonly mistakes: number;
  readonly parSeconds: number;
  readonly mistakeAllowance: number;
  readonly tileIndex: number;
  readonly gen: number;
  readonly tileSize: TileSize;
  readonly bucket: number;
};

export type ScoreNote = 'ok' | 'day-ended' | 'unavailable';

export type SubmitAccepted = {
  readonly result: 'accepted';
  readonly kind: 'scored' | 'extra' | 'late';
  readonly solveCount: number;
  /** The stitched Tile's final pixels, n × n × 2 bits, base64; sent only to the user who stitched it. */
  readonly tilePixels: string;
  /** The Solution as hex, n × n bits row-major. */
  readonly solutionMask: string;
  readonly score: ResultWire | null;
  readonly scoreNote: ScoreNote;
  readonly returnNextDay: boolean;
  readonly alreadyStitched: boolean;
};
export type SubmitResponse = SubmitAccepted | { readonly result: 'rejected' };

export type EndCardResponse = {
  readonly result: ResultWire | null;
  readonly scoreNote: ScoreNote;
  readonly rank: { readonly status: 'ok'; readonly position: number; readonly total: number } | { readonly status: 'unavailable' };
  readonly percentile:
    | { readonly status: 'ok'; readonly value: number; readonly bucket: number; readonly counts: readonly number[] }
    | { readonly status: 'too-few' | 'unavailable' };
  readonly helpCount: number | null;
  readonly streak: { readonly current: number; readonly best: number } | null;
  readonly myTiles: readonly number[];
  readonly serverNowMs: number;
  readonly nextDayAtMs: number;
  readonly flairOptIn: boolean;
  readonly editorUnlocked: boolean;
  readonly complete: boolean;
  readonly voteOpen: boolean;
};

export type CreditsResponse = {
  readonly firstStitchers: readonly { readonly tile: number; readonly name: string | null }[];
  readonly topHelpers: readonly { readonly rank: number; readonly name: string | null; readonly helpCount: number }[];
  readonly helpersExpired: boolean;
  readonly creator: { readonly name: string | null } | null;
};

export type ShareRequest = { readonly nonce: string };
export type ShareResponse = { readonly commentId: string };
export type FlairRequest = { readonly optIn: boolean };
export type FlairResponse = { readonly optIn: boolean };
export type GhostSeenResponse = Record<string, never>;
