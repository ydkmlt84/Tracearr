/**
 * Statistics Routes Module
 *
 * Orchestrates all stats-related routes and provides unified export.
 * Uses TimescaleDB continuous aggregates where possible for better performance.
 *
 * Routes:
 * - GET /dashboard - Dashboard summary metrics
 * - GET /plays - Plays over time
 * - GET /plays-by-dayofweek - Plays grouped by day of week
 * - GET /plays-by-hourofday - Plays grouped by hour of day
 * - GET /users - User statistics
 * - GET /top-users - User leaderboard
 * - GET /top-content - Top movies and shows
 * - GET /libraries - Library counts
 * - GET /locations - Geo data for stream map
 * - GET /quality - Transcode vs direct play
 * - GET /platforms - Plays by platform
 * - GET /watch-time - Watch time breakdown
 * - GET /concurrent - Concurrent stream history
 */

import type { FastifyPluginAsync } from 'fastify';
import { dashboardRoutes } from './dashboard.js';
import { playsRoutes } from './plays.js';
import { usersRoutes } from './users.js';
import { contentRoutes } from './content.js';
import { locationsRoutes } from './locations.js';
import { qualityRoutes } from './quality.js';

export const statsRoutes: FastifyPluginAsync = async (app) => {
  // Register all sub-route plugins
  // Each plugin defines its own paths (no additional prefix needed)
  await app.register(dashboardRoutes);
  await app.register(playsRoutes);
  await app.register(usersRoutes);
  await app.register(contentRoutes);
  await app.register(locationsRoutes);
  await app.register(qualityRoutes);
};

// Re-export utilities for potential use by other modules
export { getDateRange, hasAggregates } from './utils.js';
