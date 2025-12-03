/**
 * User Service Integration Tests
 *
 * Tests userService functions against a real database.
 * Requires: docker compose -f docker/docker-compose.dev.yml up -d
 *
 * Run with: pnpm test:integration
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { db } from '../../src/db/client.js';
import { servers, users, serverUsers } from '../../src/db/schema.js';
import {
  batchSyncUsersFromMediaServer,
  syncUserFromMediaServer,
  getServerUsersByServer,
  getServerUserByExternalId,
} from '../../src/services/userService.js';
import type { MediaUser } from '../../src/services/userService.js';

describe('userService integration tests', () => {
  let testServerId: string;

  beforeAll(async () => {
    // Create a test server for all tests in this suite
    const [server] = await db
      .insert(servers)
      .values({
        name: 'Integration Test Server',
        type: 'plex',
        url: 'http://localhost:32400',
        token: 'encrypted-test-token',
      })
      .returning();

    testServerId = server.id;
  });

  afterAll(async () => {
    // Clean up: delete test server and cascade to server_users
    // First delete server_users, then users, then server
    const serverUserRows = await db
      .select({ id: serverUsers.id, userId: serverUsers.userId })
      .from(serverUsers)
      .where(eq(serverUsers.serverId, testServerId));

    if (serverUserRows.length > 0) {
      await db.delete(serverUsers).where(eq(serverUsers.serverId, testServerId));

      // Delete orphaned identity users created for this test
      for (const su of serverUserRows) {
        await db.delete(users).where(eq(users.id, su.userId));
      }
    }

    await db.delete(servers).where(eq(servers.id, testServerId));
  });

  beforeEach(async () => {
    // Clean up any server_users from previous test
    const serverUserRows = await db
      .select({ id: serverUsers.id, userId: serverUsers.userId })
      .from(serverUsers)
      .where(eq(serverUsers.serverId, testServerId));

    if (serverUserRows.length > 0) {
      await db.delete(serverUsers).where(eq(serverUsers.serverId, testServerId));

      for (const su of serverUserRows) {
        await db.delete(users).where(eq(users.id, su.userId));
      }
    }
  });

  describe('syncUserFromMediaServer', () => {
    it('should create a new user and server user when none exists', async () => {
      const mediaUser: MediaUser = {
        id: `ext-${randomUUID().slice(0, 8)}`,
        username: 'newuser',
        email: 'newuser@example.com',
        thumb: 'https://example.com/thumb.jpg',
        isAdmin: false,
      };

      const result = await syncUserFromMediaServer(testServerId, mediaUser);

      expect(result.created).toBe(true);
      expect(result.serverUser.externalId).toBe(mediaUser.id);
      expect(result.serverUser.username).toBe(mediaUser.username);
      expect(result.user.username).toBe(mediaUser.username);

      // Verify in database
      const dbServerUser = await getServerUserByExternalId(testServerId, mediaUser.id);
      expect(dbServerUser).not.toBeNull();
      expect(dbServerUser?.username).toBe(mediaUser.username);
    });

    it('should update existing server user when already exists', async () => {
      const externalId = `ext-${randomUUID().slice(0, 8)}`;
      const mediaUser: MediaUser = {
        id: externalId,
        username: 'originalname',
        isAdmin: false,
      };

      // First create
      const createResult = await syncUserFromMediaServer(testServerId, mediaUser);
      expect(createResult.created).toBe(true);

      // Then update with new username
      const updatedMediaUser: MediaUser = {
        id: externalId,
        username: 'updatedname',
        email: 'updated@example.com',
        isAdmin: true,
      };

      const updateResult = await syncUserFromMediaServer(testServerId, updatedMediaUser);
      expect(updateResult.created).toBe(false);
      expect(updateResult.serverUser.username).toBe('updatedname');
    });
  });

  describe('batchSyncUsersFromMediaServer', () => {
    it('should return zeros for empty input', async () => {
      const result = await batchSyncUsersFromMediaServer(testServerId, []);

      expect(result.added).toBe(0);
      expect(result.updated).toBe(0);
    });

    it('should create multiple new users', async () => {
      const mediaUsers: MediaUser[] = [
        { id: `batch-1-${randomUUID().slice(0, 8)}`, username: 'batchuser1', isAdmin: false },
        { id: `batch-2-${randomUUID().slice(0, 8)}`, username: 'batchuser2', isAdmin: false },
        { id: `batch-3-${randomUUID().slice(0, 8)}`, username: 'batchuser3', isAdmin: true },
      ];

      const result = await batchSyncUsersFromMediaServer(testServerId, mediaUsers);

      expect(result.added).toBe(3);
      expect(result.updated).toBe(0);

      // Verify all users exist in database
      const serverUsersMap = await getServerUsersByServer(testServerId);
      expect(serverUsersMap.size).toBe(3);
      expect(serverUsersMap.get(mediaUsers[0].id)?.username).toBe('batchuser1');
      expect(serverUsersMap.get(mediaUsers[1].id)?.username).toBe('batchuser2');
      expect(serverUsersMap.get(mediaUsers[2].id)?.username).toBe('batchuser3');
    });

    it('should handle mix of new and existing users', async () => {
      // Create one user first
      const existingExternalId = `existing-${randomUUID().slice(0, 8)}`;
      await syncUserFromMediaServer(testServerId, {
        id: existingExternalId,
        username: 'existinguser',
        isAdmin: false,
      });

      // Now batch sync with mix of existing and new
      const mediaUsers: MediaUser[] = [
        { id: existingExternalId, username: 'existinguser-updated', isAdmin: false },
        { id: `new-1-${randomUUID().slice(0, 8)}`, username: 'newuser1', isAdmin: false },
        { id: `new-2-${randomUUID().slice(0, 8)}`, username: 'newuser2', isAdmin: false },
      ];

      const result = await batchSyncUsersFromMediaServer(testServerId, mediaUsers);

      expect(result.added).toBe(2);
      expect(result.updated).toBe(1);

      // Verify the existing user was updated
      const updatedUser = await getServerUserByExternalId(testServerId, existingExternalId);
      expect(updatedUser?.username).toBe('existinguser-updated');
    });

    it('should handle all existing users (update only)', async () => {
      // Create users first
      const externalIds = [
        `preexist-1-${randomUUID().slice(0, 8)}`,
        `preexist-2-${randomUUID().slice(0, 8)}`,
      ];

      for (const extId of externalIds) {
        await syncUserFromMediaServer(testServerId, {
          id: extId,
          username: `user-${extId.slice(0, 8)}`,
          isAdmin: false,
        });
      }

      // Batch sync with updates only
      const mediaUsers: MediaUser[] = externalIds.map((extId) => ({
        id: extId,
        username: `updated-${extId.slice(0, 8)}`,
        isAdmin: true,
      }));

      const result = await batchSyncUsersFromMediaServer(testServerId, mediaUsers);

      expect(result.added).toBe(0);
      expect(result.updated).toBe(2);
    });
  });

  describe('getServerUsersByServer', () => {
    it('should return empty map for server with no users', async () => {
      const result = await getServerUsersByServer(testServerId);
      expect(result.size).toBe(0);
    });

    it('should return map of all server users keyed by externalId', async () => {
      // Create some users
      const mediaUsers: MediaUser[] = [
        { id: `map-1-${randomUUID().slice(0, 8)}`, username: 'mapuser1', isAdmin: false },
        { id: `map-2-${randomUUID().slice(0, 8)}`, username: 'mapuser2', isAdmin: true },
      ];

      await batchSyncUsersFromMediaServer(testServerId, mediaUsers);

      const result = await getServerUsersByServer(testServerId);

      expect(result.size).toBe(2);
      expect(result.has(mediaUsers[0].id)).toBe(true);
      expect(result.has(mediaUsers[1].id)).toBe(true);
      expect(result.get(mediaUsers[0].id)?.username).toBe('mapuser1');
      expect(result.get(mediaUsers[1].id)?.isServerAdmin).toBe(true);
    });
  });
});
