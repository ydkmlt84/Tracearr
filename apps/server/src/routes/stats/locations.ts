/**
 * Location Statistics Routes
 *
 * GET /locations - Geo data for stream map with filtering
 */

import type { FastifyPluginAsync } from 'fastify';
import { sql } from 'drizzle-orm';
import { TIME_MS, locationStatsQuerySchema } from '@tracearr/shared';
import { db } from '../../db/client.js';

export const locationsRoutes: FastifyPluginAsync = async (app) => {
  /**
   * GET /locations - Geo data for stream map with filtering
   *
   * Supports filtering by:
   * - days: Number of days to look back (default: 30)
   * - userId: Filter to specific user
   * - serverId: Filter to specific server
   * - mediaType: Filter by movie/episode/track
   */
  app.get(
    '/locations',
    { preHandler: [app.authenticate] },
    async (request, reply) => {
      const query = locationStatsQuerySchema.safeParse(request.query);
      if (!query.success) {
        return reply.badRequest('Invalid query parameters');
      }

      const { days, serverUserId, serverId, mediaType } = query.data;
      const startDate = new Date(Date.now() - days * TIME_MS.DAY);

      // Build WHERE conditions dynamically (all qualified with 's.' for sessions table)
      const conditions: ReturnType<typeof sql>[] = [
        sql`s.started_at >= ${startDate}`,
        sql`s.geo_lat IS NOT NULL`,
        sql`s.geo_lon IS NOT NULL`,
      ];

      if (serverUserId) {
        conditions.push(sql`s.server_user_id = ${serverUserId}`);
      }
      if (serverId) {
        conditions.push(sql`s.server_id = ${serverId}`);
      }
      if (mediaType) {
        conditions.push(sql`s.media_type = ${mediaType}`);
      }

      const whereClause = sql`WHERE ${sql.join(conditions, sql` AND `)}`;

      // Count unique plays per location with filters
      // Include contextual data based on what's being filtered
      const result = await db.execute(sql`
        SELECT
          s.geo_city as city,
          s.geo_region as region,
          s.geo_country as country,
          s.geo_lat as lat,
          s.geo_lon as lon,
          COUNT(DISTINCT COALESCE(s.reference_id, s.id))::int as count,
          MAX(s.started_at) as last_activity,
          MIN(s.started_at) as first_activity,
          COUNT(DISTINCT COALESCE(s.device_id, s.player_name))::int as device_count,
          JSON_AGG(DISTINCT jsonb_build_object('id', su.id, 'username', su.username, 'thumbUrl', su.thumb_url))
            FILTER (WHERE su.id IS NOT NULL) as user_info
        FROM sessions s
        LEFT JOIN server_users su ON s.server_user_id = su.id
        ${whereClause}
        GROUP BY s.geo_city, s.geo_region, s.geo_country, s.geo_lat, s.geo_lon
        ORDER BY count DESC
        LIMIT 200
      `);

      const locationStats = (result.rows as {
        city: string | null;
        region: string | null;
        country: string | null;
        lat: number;
        lon: number;
        count: number;
        last_activity: Date;
        first_activity: Date;
        device_count: number;
        user_info: { id: string; username: string; thumbUrl: string | null }[] | null;
      }[]).map((row) => ({
        city: row.city,
        region: row.region,
        country: row.country,
        lat: row.lat,
        lon: row.lon,
        count: row.count,
        lastActivity: row.last_activity,
        firstActivity: row.first_activity,
        deviceCount: row.device_count,
        // Only include users array if NOT filtering by a specific user
        users: serverUserId ? undefined : (row.user_info ?? []).slice(0, 5),
      }));

      // Calculate summary stats for the overlay card
      const totalStreams = locationStats.reduce((sum, loc) => sum + loc.count, 0);
      const uniqueLocations = locationStats.length;
      const topCity = locationStats[0]?.city ?? null;

      // Build available filter options based on OTHER active filters
      // For each dimension, we query what values exist given the other filters

      // Base conditions (time + geo) that apply to all filter queries
      const baseConditions = [
        sql`s.started_at >= ${startDate}`,
        sql`s.geo_lat IS NOT NULL`,
        sql`s.geo_lon IS NOT NULL`,
      ];

      // Available users (apply server + mediaType filters, not user filter)
      const userConditions = [...baseConditions];
      if (serverId) userConditions.push(sql`s.server_id = ${serverId}`);
      if (mediaType) userConditions.push(sql`s.media_type = ${mediaType}`);
      const usersResult = await db.execute(sql`
        SELECT DISTINCT su.id, su.username
        FROM sessions s
        JOIN server_users su ON s.server_user_id = su.id
        WHERE ${sql.join(userConditions, sql` AND `)}
        ORDER BY su.username
      `);
      const availableUsers = (usersResult.rows as { id: string; username: string }[]);

      // Available servers (apply user + mediaType filters, not server filter)
      const serverConditions = [...baseConditions];
      if (serverUserId) serverConditions.push(sql`s.server_user_id = ${serverUserId}`);
      if (mediaType) serverConditions.push(sql`s.media_type = ${mediaType}`);
      const serversResult = await db.execute(sql`
        SELECT DISTINCT sv.id, sv.name
        FROM sessions s
        JOIN servers sv ON s.server_id = sv.id
        WHERE ${sql.join(serverConditions, sql` AND `)}
        ORDER BY sv.name
      `);
      const availableServers = (serversResult.rows as { id: string; name: string }[]);

      // Available media types (apply user + server filters, not mediaType filter)
      const mediaConditions = [...baseConditions];
      if (serverUserId) mediaConditions.push(sql`s.server_user_id = ${serverUserId}`);
      if (serverId) mediaConditions.push(sql`s.server_id = ${serverId}`);
      const mediaResult = await db.execute(sql`
        SELECT DISTINCT s.media_type
        FROM sessions s
        WHERE ${sql.join(mediaConditions, sql` AND `)}
        ORDER BY s.media_type
      `);
      const availableMediaTypes = (mediaResult.rows as { media_type: string }[])
        .map(r => r.media_type)
        .filter((t): t is 'movie' | 'episode' | 'track' =>
          t === 'movie' || t === 'episode' || t === 'track'
        );

      return {
        data: locationStats,
        summary: {
          totalStreams,
          uniqueLocations,
          topCity,
        },
        availableFilters: {
          users: availableUsers,
          servers: availableServers,
          mediaTypes: availableMediaTypes,
        },
      };
    }
  );
};
