/**
 * Stats Route Utilities Tests
 *
 * Tests pure utility functions from routes/stats/utils.ts:
 * - getDateRange: Calculate start date based on period string
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { getDateRange, resetCachedState } from '../utils.js';

describe('getDateRange', () => {
  beforeEach(() => {
    // Fix time to 2024-06-15 12:00:00 UTC for predictable tests
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2024-06-15T12:00:00Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('period calculations', () => {
    it('should return date 1 day ago for "day" period', () => {
      const result = getDateRange('day');
      expect(result).toEqual(new Date('2024-06-14T12:00:00Z'));
    });

    it('should return date 7 days ago for "week" period', () => {
      const result = getDateRange('week');
      expect(result).toEqual(new Date('2024-06-08T12:00:00Z'));
    });

    it('should return date 30 days ago for "month" period', () => {
      const result = getDateRange('month');
      expect(result).toEqual(new Date('2024-05-16T12:00:00Z'));
    });

    it('should return date 365 days ago for "year" period', () => {
      const result = getDateRange('year');
      expect(result).toEqual(new Date('2023-06-16T12:00:00Z'));
    });
  });

  describe('return type', () => {
    it('should return a Date object', () => {
      const result = getDateRange('day');
      expect(result).toBeInstanceOf(Date);
    });
  });

  describe('relative time correctness', () => {
    it('should calculate milliseconds correctly for day', () => {
      const now = new Date('2024-06-15T12:00:00Z');
      const result = getDateRange('day');
      const diffMs = now.getTime() - result.getTime();
      expect(diffMs).toBe(24 * 60 * 60 * 1000); // 1 day in ms
    });

    it('should calculate milliseconds correctly for week', () => {
      const now = new Date('2024-06-15T12:00:00Z');
      const result = getDateRange('week');
      const diffMs = now.getTime() - result.getTime();
      expect(diffMs).toBe(7 * 24 * 60 * 60 * 1000); // 7 days in ms
    });

    it('should calculate milliseconds correctly for month', () => {
      const now = new Date('2024-06-15T12:00:00Z');
      const result = getDateRange('month');
      const diffMs = now.getTime() - result.getTime();
      expect(diffMs).toBe(30 * 24 * 60 * 60 * 1000); // 30 days in ms
    });

    it('should calculate milliseconds correctly for year', () => {
      const now = new Date('2024-06-15T12:00:00Z');
      const result = getDateRange('year');
      const diffMs = now.getTime() - result.getTime();
      expect(diffMs).toBe(365 * 24 * 60 * 60 * 1000); // 365 days in ms
    });
  });
});

describe('resetCachedState', () => {
  it('should reset cached state without error', () => {
    // This function resets internal cache variables - just verify it runs
    expect(() => resetCachedState()).not.toThrow();
  });

  it('should be callable multiple times', () => {
    // Should be safe to call multiple times
    resetCachedState();
    resetCachedState();
    expect(() => resetCachedState()).not.toThrow();
  });
});
