// @vitest-environment node

import { describe, expect, it } from 'vitest';
import { formatRelativeTime } from '@/lib/relative-time';

const NOW = new Date('2026-09-15T19:00:00Z');

const ago = (ms: number): string => new Date(NOW.getTime() - ms).toISOString();

const SECOND = 1000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

describe('describing when something happened', () => {
  it('calls the last few seconds "just now"', () => {
    expect(formatRelativeTime({ iso: ago(5 * SECOND), now: NOW })).toBe('just now');
  });

  it('counts minutes', () => {
    expect(formatRelativeTime({ iso: ago(5 * MINUTE), now: NOW })).toBe('5 minutes ago');
    expect(formatRelativeTime({ iso: ago(1 * MINUTE), now: NOW })).toBe('1 minute ago');
  });

  it('counts hours', () => {
    expect(formatRelativeTime({ iso: ago(4 * HOUR), now: NOW })).toBe('4 hours ago');
  });

  it('counts days', () => {
    expect(formatRelativeTime({ iso: ago(3 * DAY), now: NOW })).toBe('3 days ago');
  });

  it('says yesterday rather than 1 day ago', () => {
    expect(formatRelativeTime({ iso: ago(1 * DAY), now: NOW })).toBe('yesterday');
  });

  // The point of relative time is that it is easier to read than a date. Past a
  // week it stops being: "23 days ago" makes a reader do arithmetic that a date
  // would have saved them.
  it('falls back to a date once relative stops being useful', () => {
    const result = formatRelativeTime({ iso: ago(30 * DAY), now: NOW });

    expect(result).not.toMatch(/ago/);
    expect(result).toMatch(/2026/);
  });

  it('does not describe the boundary between hours and days as 24 hours ago', () => {
    expect(formatRelativeTime({ iso: ago(23 * HOUR), now: NOW })).toBe('23 hours ago');
  });

  // Clock skew between the server that stamped the row and the browser reading
  // it can put a timestamp slightly in the future. "in 3 seconds" would be an
  // absurd thing to show for something that has already happened.
  it('treats a timestamp slightly in the future as just now', () => {
    expect(formatRelativeTime({ iso: ago(-30 * SECOND), now: NOW })).toBe('just now');
  });

  it('refuses to invent a time from an unparseable value', () => {
    expect(formatRelativeTime({ iso: 'not a date', now: NOW })).toBe('');
  });
});
