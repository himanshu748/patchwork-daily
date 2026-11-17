export type DayKey = string & { readonly __brand: 'DayKey' };
export type TileSize = 5 | 6 | 7;
/** UTC weekday, 0 = Sunday. */
export type Weekday = 0 | 1 | 2 | 3 | 4 | 5 | 6;

export const MS_PER_DAY = 86_400_000;
const DAY_KEY_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

export class InvalidDayKeyError extends Error {
  constructor(input: unknown) {
    const shown = typeof input === 'string' ? JSON.stringify(input.slice(0, 32)) : typeof input;
    super(`Invalid Day_Key: ${shown}`);
    this.name = 'InvalidDayKeyError';
  }
}

function isLeapYear(y: number): boolean {
  return (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
}

function monthLength(y: number, m: number): number {
  if (m === 2) return isLeapYear(y) ? 29 : 28;
  return m === 4 || m === 6 || m === 9 || m === 11 ? 30 : 31;
}

// Integer civil-date conversions (H. Hinnant's days_from_civil / civil_from_days),
// so no host time zone or Date object is ever involved.
function daysFromCivil(year: number, m: number, d: number): number {
  const y = m <= 2 ? year - 1 : year;
  const era = Math.floor(y / 400);
  const yoe = y - era * 400;
  const mp = m > 2 ? m - 3 : m + 9;
  const doy = Math.floor((153 * mp + 2) / 5) + d - 1;
  const doe = yoe * 365 + Math.floor(yoe / 4) - Math.floor(yoe / 100) + doy;
  return era * 146_097 + doe - 719_468;
}

function civilFromDays(days: number): [number, number, number] {
  const z = days + 719_468;
  const era = Math.floor(z / 146_097);
  const doe = z - era * 146_097;
  const yoe = Math.floor((doe - Math.floor(doe / 1460) + Math.floor(doe / 36_524) - Math.floor(doe / 146_096)) / 365);
  const doy = doe - (365 * yoe + Math.floor(yoe / 4) - Math.floor(yoe / 100));
  const mp = Math.floor((5 * doy + 2) / 153);
  const d = doy - Math.floor((153 * mp + 2) / 5) + 1;
  const m = mp < 10 ? mp + 3 : mp - 9;
  return [yoe + era * 400 + (m <= 2 ? 1 : 0), m, d];
}

function pad(n: number, width: number): string {
  return String(n).padStart(width, '0');
}

export function parseDayKey(input: string): DayKey | null {
  if (typeof input !== 'string') return null;
  const match = DAY_KEY_RE.exec(input);
  if (!match) return null;
  const y = Number(match[1]);
  const m = Number(match[2]);
  const d = Number(match[3]);
  if (m < 1 || m > 12 || d < 1 || d > monthLength(y, m)) return null;
  return input as DayKey;
}

export function assertDayKey(input: string): DayKey {
  const key = parseDayKey(input);
  if (key === null) throw new InvalidDayKeyError(input);
  return key;
}

/** Whole days since 1970-01-01. */
export function dayOrdinal(d: DayKey): number {
  const y = Number(d.slice(0, 4));
  const m = Number(d.slice(5, 7));
  const day = Number(d.slice(8, 10));
  return daysFromCivil(y, m, day);
}

export function dayKeyFromOrdinal(ordinal: number): DayKey {
  if (!Number.isSafeInteger(ordinal)) throw new RangeError('Day ordinal must be an integer');
  const [y, m, d] = civilFromDays(ordinal);
  if (y < 0 || y > 9999) throw new RangeError('Day ordinal outside years 0000 to 9999');
  return `${pad(y, 4)}-${pad(m, 2)}-${pad(d, 2)}` as DayKey;
}

export function dayKeyFromMs(utcMs: number): DayKey {
  return dayKeyFromOrdinal(Math.floor(utcMs / MS_PER_DAY));
}

export function addDays(d: DayKey, days: number): DayKey {
  return dayKeyFromOrdinal(dayOrdinal(d) + days);
}

export function utcWeekday(d: DayKey): Weekday {
  // 1970-01-01 was a Thursday.
  return ((((dayOrdinal(d) + 4) % 7) + 7) % 7) as Weekday;
}

export function tileSizeFor(d: DayKey): TileSize {
  const wd = utcWeekday(d);
  if (wd >= 1 && wd <= 3) return 5;
  if (wd === 4 || wd === 5) return 6;
  return 7;
}

export function dayNumber(d: DayKey, startDate: DayKey): number {
  return dayOrdinal(d) - dayOrdinal(startDate) + 1;
}

export function dayStartMs(d: DayKey): number {
  return dayOrdinal(d) * MS_PER_DAY;
}

export function dayEndMs(d: DayKey): number {
  return dayStartMs(d) + MS_PER_DAY;
}

/** Monday of the Monday-to-Sunday week that contains d. */
export function voteWeekMonday(d: DayKey): DayKey {
  return addDays(d, -((utcWeekday(d) + 6) % 7));
}

/** Saturday 12:00 UTC of the week that starts on `monday`. */
export function voteCloseMs(monday: DayKey): number {
  return dayStartMs(monday) + 5 * MS_PER_DAY + MS_PER_DAY / 2;
}

/** From 1 to 86,400,000; nowMs plus the result is always a UTC midnight. */
export function msUntilNextUtcMidnight(nowMs: number): number {
  return (Math.floor(nowMs / MS_PER_DAY) + 1) * MS_PER_DAY - nowMs;
}
