/**
 * Play Statistics Routes
 *
 * GET /plays - Plays over time
 * GET /plays-by-dayofweek - Plays grouped by day of week
 * GET /plays-by-hourofday - Plays grouped by hour of day
 */

import type { FastifyPluginAsync } from 'fastify';
import { sql, gte } from 'drizzle-orm';
import { statsQuerySchema } from '@tracearr/shared';
import { db } from '../../db/client.js';
import { sessions } from '../../db/schema.js';
import { getDateRange, hasAggregates } from './utils.js';

export const playsRoutes: FastifyPluginAsync = async (app) => {
  /**
   * GET /plays - Plays over time
   */
  app.get(
    '/plays',
    { preHandler: [app.authenticate] },
    async (request, reply) => {
      const query = statsQuerySchema.safeParse(request.query);
      if (!query.success) {
        return reply.badRequest('Invalid query parameters');
      }

      const { period } = query.data;
      const startDate = getDateRange(period);

      // Note: Continuous aggregates use COUNT(*) which counts sessions, not unique plays.
      // For accurate play counts, we use raw query with DISTINCT COALESCE(reference_id, id).
      // TODO: Recreate continuous aggregates with proper grouping for better performance.
      const playsByDate = await db
        .select({
          date: sql<string>`date_trunc('day', started_at)::date::text`,
          count: sql<number>`count(DISTINCT COALESCE(reference_id, id))::int`,
        })
        .from(sessions)
        .where(gte(sessions.startedAt, startDate))
        .groupBy(sql`date_trunc('day', started_at)`)
        .orderBy(sql`date_trunc('day', started_at)`);

      return { data: playsByDate };
    }
  );

  /**
   * GET /plays-by-dayofweek - Plays grouped by day of week
   */
  app.get(
    '/plays-by-dayofweek',
    { preHandler: [app.authenticate] },
    async (request, reply) => {
      const query = statsQuerySchema.safeParse(request.query);
      if (!query.success) {
        return reply.badRequest('Invalid query parameters');
      }

      const { period } = query.data;
      const startDate = getDateRange(period);

      const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

      let dayStats: { day: number; count: number }[];

      if (await hasAggregates()) {
        // Use continuous aggregate
        const result = await db.execute(sql`
          SELECT
            day_of_week as day,
            SUM(play_count)::int as count
          FROM daily_play_patterns
          WHERE week >= ${startDate}
          GROUP BY day_of_week
          ORDER BY day_of_week
        `);
        dayStats = (result.rows as { day: number; count: number }[]);
      } else {
        // Fallback to raw query
        const result = await db.execute(sql`
          SELECT
            EXTRACT(DOW FROM started_at)::int as day,
            COUNT(DISTINCT COALESCE(reference_id, id))::int as count
          FROM sessions
          WHERE started_at >= ${startDate}
          GROUP BY EXTRACT(DOW FROM started_at)
          ORDER BY day
        `);
        dayStats = (result.rows as { day: number; count: number }[]);
      }

      // Ensure all 7 days are present (fill missing with 0)
      const dayMap = new Map(dayStats.map((d) => [d.day, d.count]));
      const data = Array.from({ length: 7 }, (_, i) => ({
        day: i,
        name: DAY_NAMES[i],
        count: dayMap.get(i) ?? 0,
      }));

      return { data };
    }
  );

  /**
   * GET /plays-by-hourofday - Plays grouped by hour of day
   */
  app.get(
    '/plays-by-hourofday',
    { preHandler: [app.authenticate] },
    async (request, reply) => {
      const query = statsQuerySchema.safeParse(request.query);
      if (!query.success) {
        return reply.badRequest('Invalid query parameters');
      }

      const { period } = query.data;
      const startDate = getDateRange(period);

      let hourStats: { hour: number; count: number }[];

      if (await hasAggregates()) {
        // Use continuous aggregate
        const result = await db.execute(sql`
          SELECT
            hour_of_day as hour,
            SUM(play_count)::int as count
          FROM hourly_play_patterns
          WHERE day >= ${startDate}
          GROUP BY hour_of_day
          ORDER BY hour_of_day
        `);
        hourStats = (result.rows as { hour: number; count: number }[]);
      } else {
        // Fallback to raw query
        const result = await db.execute(sql`
          SELECT
            EXTRACT(HOUR FROM started_at)::int as hour,
            COUNT(DISTINCT COALESCE(reference_id, id))::int as count
          FROM sessions
          WHERE started_at >= ${startDate}
          GROUP BY EXTRACT(HOUR FROM started_at)
          ORDER BY hour
        `);
        hourStats = (result.rows as { hour: number; count: number }[]);
      }

      // Ensure all 24 hours are present (fill missing with 0)
      const hourMap = new Map(hourStats.map((h) => [h.hour, h.count]));
      const data = Array.from({ length: 24 }, (_, i) => ({
        hour: i,
        count: hourMap.get(i) ?? 0,
      }));

      return { data };
    }
  );
};
