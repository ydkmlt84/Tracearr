/**
 * Jellyfin Authentication Routes
 *
 * POST /jellyfin/connect-api-key - Connect a Jellyfin server with API key (requires authentication)
 */

import type { FastifyPluginAsync } from 'fastify';
import { eq, and } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '../../db/client.js';
import { servers } from '../../db/schema.js';
import { JellyfinClient } from '../../services/mediaServer/index.js';
import { encrypt } from '../../utils/crypto.js';
import { generateTokens } from './utils.js';

// Schema for API key connection
const jellyfinConnectApiKeySchema = z.object({
  serverUrl: z.url(),
  serverName: z.string().min(1).max(100),
  apiKey: z.string().min(1),
});

export const jellyfinRoutes: FastifyPluginAsync = async (app) => {
  /**
   * POST /jellyfin/connect-api-key - Connect a Jellyfin server with API key (requires authentication)
   */
  app.post(
    '/jellyfin/connect-api-key',
    { preHandler: [app.authenticate] },
    async (request, reply) => {
      const body = jellyfinConnectApiKeySchema.safeParse(request.body);
      if (!body.success) {
        return reply.badRequest('serverUrl, serverName, and apiKey are required');
      }

      const authUser = request.user;

      // Only owners can add servers
      if (authUser.role !== 'owner') {
        return reply.forbidden('Only owners can add servers');
      }

      const { serverUrl, serverName, apiKey } = body.data;

      try {
        // Verify the API key has admin access
        const isAdmin = await JellyfinClient.verifyServerAdmin(apiKey, serverUrl);

        if (!isAdmin) {
          return reply.forbidden('API key does not have administrator access to this Jellyfin server');
        }

        // Create or update server
        let server = await db
          .select()
          .from(servers)
          .where(and(eq(servers.url, serverUrl), eq(servers.type, 'jellyfin')))
          .limit(1);

        if (server.length === 0) {
          const inserted = await db
            .insert(servers)
            .values({
              name: serverName,
              type: 'jellyfin',
              url: serverUrl,
              token: encrypt(apiKey),
            })
            .returning();
          server = inserted;
        } else {
          const existingServer = server[0]!;
          await db
            .update(servers)
            .set({
              name: serverName,
              token: encrypt(apiKey),
              updatedAt: new Date(),
            })
            .where(eq(servers.id, existingServer.id));
        }

        const serverId = server[0]!.id;

        app.log.info({ userId: authUser.userId, serverId }, 'Jellyfin server connected via API key');

        // Return updated tokens with new server access
        return generateTokens(app, authUser.userId, authUser.username, authUser.role);
      } catch (error) {
        app.log.error({ error }, 'Jellyfin connect-api-key failed');
        return reply.internalServerError('Failed to connect Jellyfin server');
      }
    }
  );
};
