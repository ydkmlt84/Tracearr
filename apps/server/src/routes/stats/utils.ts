/**
 * Stats Route Utilities
 *
 * Shared helpers for statistics routes including date range calculation
 * and TimescaleDB aggregate availability checking.
 */

import { TIME_MS } from '@tracearr/shared';
import { getTimescaleStatus } from '../../db/timescale.js';

// Cache whether aggregates are available (checked once at startup)
let aggregatesAvailable: boolean | null = null;

/**
 * Check if TimescaleDB continuous aggregates are available.
 * Result is cached after first check.
 */
export async function hasAggregates(): Promise<boolean> {
  if (aggregatesAvailable !== null) {
    return aggregatesAvailable;
  }
  try {
    const status = await getTimescaleStatus();
    aggregatesAvailable = status.continuousAggregates.length >= 3;
    return aggregatesAvailable;
  } catch {
    aggregatesAvailable = false;
    return false;
  }
}

/**
 * Calculate start date based on period string.
 *
 * @param period - Time period: 'day', 'week', 'month', or 'year'
 * @returns Date representing the start of the period
 */
export function getDateRange(period: 'day' | 'week' | 'month' | 'year'): Date {
  const now = new Date();
  switch (period) {
    case 'day':
      return new Date(now.getTime() - TIME_MS.DAY);
    case 'week':
      return new Date(now.getTime() - TIME_MS.WEEK);
    case 'month':
      return new Date(now.getTime() - 30 * TIME_MS.DAY);
    case 'year':
      return new Date(now.getTime() - 365 * TIME_MS.DAY);
  }
}
