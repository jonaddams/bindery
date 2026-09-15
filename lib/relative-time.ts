/**
 * How long ago something happened, for a reader rather than a machine.
 *
 * A bare date is the wrong unit for a feed of recent things: every mention from
 * today renders identically, and the reader learns nothing from a value they
 * cannot compare to now.
 *
 * Relative time has the opposite failure, though, and it arrives quickly — "23
 * days ago" makes a reader do arithmetic that a date would have saved them. So
 * this switches to an absolute date once the relative form stops being the
 * easier thing to read.
 *
 * Built on `Intl.RelativeTimeFormat`, so the wording follows the reader's locale
 * rather than being English assembled by hand. `numeric: 'auto'` is what turns
 * "1 day ago" into "yesterday".
 */

const SECOND = 1000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** Past this, a date reads more easily than a count of days. */
const RELATIVE_LIMIT = 7 * DAY;

/**
 * Below this, "n seconds ago" is noise — and it covers small clock differences
 * between the server that stamped the row and the browser reading it, which can
 * otherwise put a past event a few seconds in the future.
 */
const JUST_NOW = 45 * SECOND;

export const formatRelativeTime = (options: { iso: string; now?: Date }): string => {
  const { iso, now = new Date() } = options;

  const then = new Date(iso);

  if (Number.isNaN(then.getTime())) {
    // Better to show nothing than to invent a time.
    return '';
  }

  const elapsed = now.getTime() - then.getTime();

  // Negative elapsed means the timestamp is in the future, which for something
  // that has already happened means clock skew rather than time travel.
  if (elapsed < JUST_NOW) {
    return 'just now';
  }

  if (elapsed >= RELATIVE_LIMIT) {
    return then.toLocaleDateString(undefined, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  }

  const relative = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' });

  if (elapsed < HOUR) {
    return relative.format(-Math.floor(elapsed / MINUTE), 'minute');
  }

  if (elapsed < DAY) {
    return relative.format(-Math.floor(elapsed / HOUR), 'hour');
  }

  return relative.format(-Math.floor(elapsed / DAY), 'day');
};
