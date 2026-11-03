/**
 * The masthead's date line. reVINYL is laid out like a newspaper, so every day
 * is a new "issue": No. 1 is the day the site launched.
 */

/** The first issue. Days before it still count as No. 1. */
export const FIRST_ISSUE = new Date(2026, 10, 1); // November 1, 2026 (months start at 0)

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** "Sunday, November 8, 2026" in the reader's own time zone. */
export function editionDate(date) {
  return date.toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  });
}

/** Days since the first issue, counted by calendar day so the time of day doesn't matter. */
export function issueNumber(date) {
  const today = Date.UTC(date.getFullYear(), date.getMonth(), date.getDate());
  const first = Date.UTC(FIRST_ISSUE.getFullYear(), FIRST_ISSUE.getMonth(), FIRST_ISSUE.getDate());
  return Math.max(1, Math.floor((today - first) / MS_PER_DAY) + 1);
}
