/**
 * Dashboard Statistics Route
 *
 * GET /dashboard - Dashboard summary metrics (active streams, plays, watch time, alerts)
 */

import type { FastifyPluginAsync } from 'fastify';
import { REDIS_KEYS, TIME_MS, type DashboardStats, type ActiveSession } from '@tracearr/shared';
import {
  playsCountSince,
  watchTimeSince,
  violationsCountSince,
} from '../../db/prepared.js';

export const dashboardRoutes: FastifyPluginAsync = async (app) => {
  /**
   * GET /dashboard - Dashboard summary metrics
   */
  app.get(
    '/dashboard',
    { preHandler: [app.authenticate] },
    async () => {
      // Try cache first
      const cached = await app.redis.get(REDIS_KEYS.DASHBOARD_STATS);
      if (cached) {
        try {
          return JSON.parse(cached) as DashboardStats;
        } catch {
          // Fall through to compute
        }
      }

      // Get active streams count
      const activeCached = await app.redis.get(REDIS_KEYS.ACTIVE_SESSIONS);
      let activeStreams = 0;
      if (activeCached) {
        try {
          const sessions = JSON.parse(activeCached) as ActiveSession[];
          activeStreams = sessions.length;
        } catch {
          // Ignore
        }
      }

      // Get today's plays and watch time using prepared statements for performance
      // Prepared statements allow PostgreSQL to reuse query plans across executions
      const todayStart = new Date();
      todayStart.setHours(0, 0, 0, 0);
      const last24h = new Date(Date.now() - TIME_MS.DAY);

      // Use prepared statements for dashboard queries (10-30% faster due to plan reuse)
      const [todayPlaysResult, watchTimeResult, alertsResult] = await Promise.all([
        playsCountSince.execute({ since: todayStart }),
        watchTimeSince.execute({ since: last24h }),
        violationsCountSince.execute({ since: last24h }),
      ]);

      const todayPlays = todayPlaysResult[0]?.count ?? 0;
      const watchTimeHours = Math.round(
        (Number(watchTimeResult[0]?.totalMs ?? 0) / (1000 * 60 * 60)) * 10
      ) / 10;
      const alertsLast24h = alertsResult[0]?.count ?? 0;

      const stats: DashboardStats = {
        activeStreams,
        todayPlays,
        watchTimeHours,
        alertsLast24h,
      };

      // Cache for 60 seconds
      await app.redis.setex(REDIS_KEYS.DASHBOARD_STATS, 60, JSON.stringify(stats));

      return stats;
    }
  );
};
