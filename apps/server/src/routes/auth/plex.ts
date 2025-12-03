/**
 * Plex Authentication Routes
 *
 * POST /plex/check-pin - Check Plex PIN status
 * POST /plex/connect - Complete Plex signup and connect a server
 */

import type { FastifyPluginAsync } from 'fastify';
import { eq, and } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '../../db/client.js';
import { servers, users, serverUsers } from '../../db/schema.js';
import { PlexClient } from '../../services/mediaServer/index.js';
import { encrypt } from '../../utils/crypto.js';
import {
  generateTokens,
  generateTempToken,
  PLEX_TEMP_TOKEN_PREFIX,
  PLEX_TEMP_TOKEN_TTL,
} from './utils.js';
import { getUserByPlexAccountId, getOwnerUser, getUserById } from '../../services/userService.js';

// Schemas
const plexCheckPinSchema = z.object({
  pinId: z.string(),
});

const plexConnectSchema = z.object({
  tempToken: z.string(),
  serverUri: z.url(),
  serverName: z.string().min(1).max(100),
});

export const plexRoutes: FastifyPluginAsync = async (app) => {
  /**
   * POST /plex/check-pin - Check Plex PIN status
   *
   * Returns:
   * - { authorized: false } if PIN not yet claimed
   * - { authorized: true, accessToken, refreshToken, user } if user found by plexAccountId
   * - { authorized: true, needsServerSelection: true, servers, tempToken } if new Plex user
   */
  app.post('/plex/check-pin', async (request, reply) => {
    const body = plexCheckPinSchema.safeParse(request.body);
    if (!body.success) {
      return reply.badRequest('pinId is required');
    }

    const { pinId } = body.data;

    try {
      const authResult = await PlexClient.checkOAuthPin(pinId);

      if (!authResult) {
        return { authorized: false, message: 'PIN not yet authorized' };
      }

      // Check if user exists by Plex account ID (global Plex.tv ID)
      let existingUser = await getUserByPlexAccountId(authResult.id);

      // Fallback: Check by externalId in server_users (server-synced users may have Plex ID there)
      if (!existingUser) {
        const fallbackServerUsers = await db
          .select({ userId: serverUsers.userId })
          .from(serverUsers)
          .where(eq(serverUsers.externalId, authResult.id))
          .limit(1);
        if (fallbackServerUsers[0]) {
          existingUser = await getUserById(fallbackServerUsers[0].userId);
        }
      }

      if (existingUser) {
        // Returning Plex user - update their info and link plex_account_id
        const user = existingUser;

        await db
          .update(users)
          .set({
            username: authResult.username,
            email: authResult.email,
            thumbnail: authResult.thumb,
            plexAccountId: authResult.id, // Link the Plex account ID
            updatedAt: new Date(),
          })
          .where(eq(users.id, user.id));

        app.log.info({ userId: user.id }, 'Returning Plex user login');

        return {
          authorized: true,
          ...(await generateTokens(app, user.id, authResult.username, user.role)),
        };
      }

      // New Plex user - check if they own any servers
      const plexServers = await PlexClient.getServers(authResult.token);

      // Check if this is the first owner
      const owner = await getOwnerUser();
      const isFirstUser = !owner;

      // Store temp token for completing registration
      const tempToken = generateTempToken();
      await app.redis.setex(
        `${PLEX_TEMP_TOKEN_PREFIX}${tempToken}`,
        PLEX_TEMP_TOKEN_TTL,
        JSON.stringify({
          plexAccountId: authResult.id,
          plexUsername: authResult.username,
          plexEmail: authResult.email,
          plexThumb: authResult.thumb,
          plexToken: authResult.token,
          isFirstUser,
        })
      );

      // If they have servers, let them select one to connect
      if (plexServers.length > 0) {
        const formattedServers = plexServers.map((s) => ({
          name: s.name,
          platform: s.platform,
          version: s.productVersion,
          connections: s.connections.map((c) => ({
            uri: c.uri,
            local: c.local,
            address: c.address,
            port: c.port,
          })),
        }));

        return {
          authorized: true,
          needsServerSelection: true,
          servers: formattedServers,
          tempToken,
        };
      }

      // No servers - create account without server connection
      // First user becomes owner, subsequent users are viewers
      const role = isFirstUser ? 'owner' : 'viewer';

      const [newUser] = await db
        .insert(users)
        .values({
          username: authResult.username,
          email: authResult.email,
          thumbnail: authResult.thumb,
          plexAccountId: authResult.id,
          role,
        })
        .returning();

      if (!newUser) {
        return reply.internalServerError('Failed to create user');
      }

      // Clean up temp token
      await app.redis.del(`${PLEX_TEMP_TOKEN_PREFIX}${tempToken}`);

      app.log.info({ userId: newUser.id, role }, 'New Plex user created (no servers)');

      return {
        authorized: true,
        ...(await generateTokens(app, newUser.id, newUser.username, newUser.role)),
      };
    } catch (error) {
      app.log.error({ error }, 'Plex check-pin failed');
      return reply.internalServerError('Failed to check Plex authorization');
    }
  });

  /**
   * POST /plex/connect - Complete Plex signup and connect a server
   */
  app.post('/plex/connect', async (request, reply) => {
    const body = plexConnectSchema.safeParse(request.body);
    if (!body.success) {
      return reply.badRequest('tempToken, serverUri, and serverName are required');
    }

    const { tempToken, serverUri, serverName } = body.data;

    // Get stored Plex auth from temp token
    const stored = await app.redis.get(`${PLEX_TEMP_TOKEN_PREFIX}${tempToken}`);
    if (!stored) {
      return reply.unauthorized('Invalid or expired temp token. Please restart login.');
    }

    // Delete temp token (one-time use)
    await app.redis.del(`${PLEX_TEMP_TOKEN_PREFIX}${tempToken}`);

    const { plexAccountId, plexUsername, plexEmail, plexThumb, plexToken, isFirstUser } = JSON.parse(
      stored
    ) as {
      plexAccountId: string;
      plexUsername: string;
      plexEmail: string;
      plexThumb: string;
      plexToken: string;
      isFirstUser: boolean;
    };

    try {
      // Verify user is admin on the selected server
      const isAdmin = await PlexClient.verifyServerAdmin(plexToken, serverUri);
      if (!isAdmin) {
        return reply.forbidden('You must be an admin on the selected Plex server');
      }

      // Create or update server
      let server = await db
        .select()
        .from(servers)
        .where(and(eq(servers.url, serverUri), eq(servers.type, 'plex')))
        .limit(1);

      if (server.length === 0) {
        const inserted = await db
          .insert(servers)
          .values({
            name: serverName,
            type: 'plex',
            url: serverUri,
            token: encrypt(plexToken),
          })
          .returning();
        server = inserted;
      } else {
        const existingServer = server[0]!;
        await db
          .update(servers)
          .set({ token: encrypt(plexToken), updatedAt: new Date() })
          .where(eq(servers.id, existingServer.id));
      }

      const serverId = server[0]!.id;

      // Create user identity (no serverId on users table)
      // First user becomes owner, subsequent users are viewers
      const role = isFirstUser ? 'owner' : 'viewer';

      const [newUser] = await db
        .insert(users)
        .values({
          username: plexUsername,
          email: plexEmail,
          thumbnail: plexThumb,
          plexAccountId: plexAccountId,
          role,
        })
        .returning();

      if (!newUser) {
        return reply.internalServerError('Failed to create user');
      }

      // Create server_user linking the identity to this server
      await db.insert(serverUsers).values({
        userId: newUser.id,
        serverId,
        externalId: plexAccountId,
        username: plexUsername,
        email: plexEmail,
        thumbUrl: plexThumb,
        isServerAdmin: true, // They verified as admin
      });

      app.log.info({ userId: newUser.id, serverId, role }, 'New Plex user with server created');

      return generateTokens(app, newUser.id, newUser.username, newUser.role);
    } catch (error) {
      app.log.error({ error }, 'Plex connect failed');
      return reply.internalServerError('Failed to connect to Plex server');
    }
  });
};
