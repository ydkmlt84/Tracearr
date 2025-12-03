/**
 * Quality and Performance Statistics Routes
 *
 * GET /quality - Transcode vs direct play breakdown
 * GET /platforms - Plays by platform
 * GET /watch-time - Total watch time breakdown
 * GET /concurrent - Concurrent stream history
 */

import type { FastifyPluginAsync } from 'fastify';
import { sql, gte } from 'drizzle-orm';
import { statsQuerySchema } from '@tracearr/shared';
import { db } from '../../db/client.js';
import { sessions } from '../../db/schema.js';
import {
  playsByPlatformSince,
  qualityStatsSince,
  watchTimeSince,
  watchTimeByTypeSince,
} from '../../db/prepared.js';
import { getDateRange, hasAggregates } from './utils.js';

export const qualityRoutes: FastifyPluginAsync = async (app) => {
  /**
   * GET /quality - Transcode vs direct play breakdown
   * Uses prepared statement for 10-30% query plan reuse speedup
   */
  app.get(
    '/quality',
    { preHandler: [app.authenticate] },
    async (request, reply) => {
      const query = statsQuerySchema.safeParse(request.query);
      if (!query.success) {
        return reply.badRequest('Invalid query parameters');
      }

      const { period } = query.data;
      const startDate = getDateRange(period);

      // Use prepared statement for better performance
      const qualityStats = await qualityStatsSince.execute({ since: startDate });

      const directPlay = qualityStats.find((q) => !q.isTranscode)?.count ?? 0;
      const transcode = qualityStats.find((q) => q.isTranscode)?.count ?? 0;
      const total = directPlay + transcode;

      return {
        directPlay,
        transcode,
        total,
        directPlayPercent: total > 0 ? Math.round((directPlay / total) * 100) : 0,
        transcodePercent: total > 0 ? Math.round((transcode / total) * 100) : 0,
      };
    }
  );

  /**
   * GET /platforms - Plays by platform
   * Uses prepared statement for 10-30% query plan reuse speedup
   */
  app.get(
    '/platforms',
    { preHandler: [app.authenticate] },
    async (request, reply) => {
      const query = statsQuerySchema.safeParse(request.query);
      if (!query.success) {
        return reply.badRequest('Invalid query parameters');
      }

      const { period } = query.data;
      const startDate = getDateRange(period);

      // Use prepared statement for better performance
      const platformStats = await playsByPlatformSince.execute({ since: startDate });

      return { data: platformStats };
    }
  );

  /**
   * GET /watch-time - Total watch time breakdown
   * Uses prepared statements for 10-30% query plan reuse speedup
   */
  app.get(
    '/watch-time',
    { preHandler: [app.authenticate] },
    async (request, reply) => {
      const query = statsQuerySchema.safeParse(request.query);
      if (!query.success) {
        return reply.badRequest('Invalid query parameters');
      }

      const { period } = query.data;
      const startDate = getDateRange(period);

      // Use prepared statements for better performance
      const [totalResult, byTypeResult] = await Promise.all([
        watchTimeSince.execute({ since: startDate }),
        watchTimeByTypeSince.execute({ since: startDate }),
      ]);

      return {
        totalHours: Math.round((Number(totalResult[0]?.totalMs ?? 0) / (1000 * 60 * 60)) * 10) / 10,
        byType: byTypeResult.map((t) => ({
          mediaType: t.mediaType,
          hours: Math.round((Number(t.totalMs) / (1000 * 60 * 60)) * 10) / 10,
        })),
      };
    }
  );

  /**
   * GET /concurrent - Concurrent stream history
   */
  app.get(
    '/concurrent',
    { preHandler: [app.authenticate] },
    async (request, reply) => {
      const query = statsQuerySchema.safeParse(request.query);
      if (!query.success) {
        return reply.badRequest('Invalid query parameters');
      }

      const { period } = query.data;
      const startDate = getDateRange(period);

      let hourlyData: { hour: string; maxConcurrent: number }[];

      if (await hasAggregates()) {
        // Use continuous aggregate - sums across servers
        const result = await db.execute(sql`
          SELECT
            hour::text,
            SUM(stream_count)::int as max_concurrent
          FROM hourly_concurrent_streams
          WHERE hour >= ${startDate}
          GROUP BY hour
          ORDER BY hour
        `);
        hourlyData = (result.rows as { hour: string; max_concurrent: number }[]).map((r) => ({
          hour: r.hour,
          maxConcurrent: r.max_concurrent,
        }));
      } else {
        // Fallback to raw sessions query
        // This is simplified - a production version would use time-range overlaps
        const result = await db
          .select({
            hour: sql<string>`date_trunc('hour', started_at)::text`,
            maxConcurrent: sql<number>`count(*)::int`,
          })
          .from(sessions)
          .where(gte(sessions.startedAt, startDate))
          .groupBy(sql`date_trunc('hour', started_at)`)
          .orderBy(sql`date_trunc('hour', started_at)`);
        hourlyData = result;
      }

      return { data: hourlyData };
    }
  );
};
