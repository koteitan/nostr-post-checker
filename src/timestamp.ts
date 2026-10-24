// Timestamp / kind parsing helpers, ported verbatim in behavior from the
// original main.js (number coercions added for TypeScript strict mode).

// Timezone abbreviation to offset mapping
export const timezoneMap: Record<string, string> = {
  // Asia
  JST: "+0900", // Japan Standard Time
  KST: "+0900", // Korea Standard Time
  HKT: "+0800", // Hong Kong Time
  SGT: "+0800", // Singapore Time
  IST: "+0530", // India Standard Time
  PHT: "+0800", // Philippine Time
  WIB: "+0700", // Western Indonesian Time
  THA: "+0700", // Thailand Standard Time

  // Australia & Pacific
  AEST: "+1000", // Australian Eastern Standard Time
  ACST: "+0930", // Australian Central Standard Time
  AWST: "+0800", // Australian Western Standard Time
  NZST: "+1200", // New Zealand Standard Time
  NZDT: "+1300", // New Zealand Daylight Time

  // Europe & Africa
  GMT: "+0000", // Greenwich Mean Time
  UTC: "+0000", // Coordinated Universal Time
  BST: "+0100", // British Summer Time
  CET: "+0100", // Central European Time
  CEST: "+0200", // Central European Summer Time
  EET: "+0200", // Eastern European Time
  EEST: "+0300", // Eastern European Summer Time
  MSK: "+0300", // Moscow Time
  SAST: "+0200", // South African Standard Time

  // Americas
  EST: "-0500", // Eastern Standard Time
  EDT: "-0400", // Eastern Daylight Time
  // The original listed CST twice (China +0800, then this one); in a JS object
  // literal the later key wins, so CST has always meant -0600.
  CST: "-0600", // Central Standard Time (North America)
  CDT: "-0500", // Central Daylight Time
  MST: "-0700", // Mountain Standard Time
  MDT: "-0600", // Mountain Daylight Time
  PST: "-0800", // Pacific Standard Time
  PDT: "-0700", // Pacific Daylight Time
  AKST: "-0900", // Alaska Standard Time
  AKDT: "-0800", // Alaska Daylight Time
  HST: "-1000", // Hawaii Standard Time
  BRT: "-0300", // Brasilia Time
  ART: "-0300", // Argentina Time
};

// True when the fields name a real calendar date and time of day.
function isRealDateTime(y: number, mo: number, d: number, h: number, mi: number, s: number): boolean {
  const leap = (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][mo - 1];
  return days !== undefined && d >= 1 && d <= days && h <= 23 && mi <= 59 && s <= 59;
}

// Parse timestamp input (Unix timestamp or date string with optional timezone).
// Returns null when the input is not in an accepted format or names a date or
// time that does not exist.
export function parseTimestamp(input: string): number | null {
  if (!input || input.trim() === "") return null;

  const inputStr = input.trim();

  // A pure number long enough to be a unix timestamp
  if (inputStr.match(/^\d+$/) && inputStr.length >= 9) {
    return parseInt(inputStr);
  }

  // YYYY-MM-DD or YYYY/MM/DD with optional HH:MM:SS [TIMEZONE]
  const matchWithTz = inputStr.match(
    /^(\d{4})[-/](\d{1,2})[-/](\d{1,2})(?:\s+(\d{2}):(\d{2}):(\d{2}))?(?:\s*((?:[+-]\d{2}:?\d{2})|(?:[A-Z]{3,4})))?$/
  );
  if (matchWithTz) {
    const [y, mo, d, h, mi, s] = matchWithTz.slice(1, 7).map((x) => Number(x ?? 0));
    const timezone = matchWithTz[7];

    // A date or time that does not exist is ignored, instead of letting Date roll
    // it over (2024/02/30 -> 03/01) or produce NaN.
    if (!isRealDateTime(y, mo, d, h, mi, s)) return null;

    // offset of the given timezone in minutes; null means the local timezone
    let offsetMin: number | null = null;
    if (timezone) {
      const off = timezone.startsWith("+") || timezone.startsWith("-") ? timezone : timezoneMap[timezone];
      // an unknown abbreviation falls back to the local timezone
      if (off !== undefined) {
        const m = off.match(/^([+-])(\d{2}):?(\d{2})$/);
        if (!m || Number(m[2]) > 14 || Number(m[3]) > 59) return null;
        offsetMin = (m[1] === "-" ? -1 : 1) * (Number(m[2]) * 60 + Number(m[3]));
      }
    }

    // build from numbers (not by parsing a string, which differs among browsers);
    // setFullYear also keeps years below 100 as they are
    const date = new Date(0);
    if (offsetMin === null) {
      date.setFullYear(y, mo - 1, d);
      date.setHours(h, mi, s, 0);
      return Math.floor(date.getTime() / 1000);
    }
    date.setUTCFullYear(y, mo - 1, d);
    date.setUTCHours(h, mi, s, 0);
    return Math.floor(date.getTime() / 1000) - offsetMin * 60;
  }

  return null;
}

// Parse a kind input string into an array of numbers
export function parseKinds(kindStr: string): number[] {
  if (!kindStr.trim()) return [];
  return kindStr
    .split(/[,\s]+/)
    .filter((k) => k.trim() !== "")
    .map((k) => parseInt(k.trim()))
    .filter((k) => !isNaN(k));
}

// Parse a date string or timestamp to a unix timestamp
export function parseDate(dateStr: string): number | null {
  if (!dateStr || dateStr.trim() === "") return null;

  if (!isNaN(Number(dateStr)) && dateStr.length >= 9) {
    return parseInt(dateStr);
  }

  try {
    const date = new Date(dateStr);
    if (!isNaN(date.getTime())) {
      return Math.floor(date.getTime() / 1000);
    }
  } catch (e) {
    /* ignore */
  }

  return null;
}
