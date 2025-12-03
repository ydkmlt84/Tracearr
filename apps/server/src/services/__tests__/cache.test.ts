/**
 * Cache Service Tests
 *
 * Tests the ACTUAL createCacheService and createPubSubService from cache.ts:
 * - CacheService: Redis-backed caching for sessions, stats, etc.
 * - PubSubService: Pub/sub for real-time events
 *
 * These tests validate:
 * - Get/set operations with mock Redis
 * - JSON parsing error handling
 * - Pattern-based invalidation
 * - Set operations for user sessions
 * - Pub/sub message routing
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { Redis } from 'ioredis';

// Import ACTUAL production functions - not local duplicates
import {
  createCacheService,
  createPubSubService,
  getPubSubService,
  type CacheService,
  type PubSubService,
} from '../cache.js';

// Mock Redis instance factory
function createMockRedis(): Redis & {
  store: Map<string, string>;
  sets: Map<string, Set<string>>;
  ttls: Map<string, number>;
} {
  const store = new Map<string, string>();
  const sets = new Map<string, Set<string>>();
  const ttls = new Map<string, number>();
  const messageCallbacks: Array<(channel: string, message: string) => void> = [];

  return {
    store,
    sets,
    ttls,
    // String operations
    get: vi.fn(async (key: string) => store.get(key) ?? null),
    setex: vi.fn(async (key: string, seconds: number, value: string) => {
      store.set(key, value);
      ttls.set(key, seconds);
      return 'OK';
    }),
    del: vi.fn(async (...keys: string[]) => {
      let count = 0;
      for (const key of keys) {
        if (store.delete(key) || sets.delete(key)) count++;
      }
      return count;
    }),
    keys: vi.fn(async (pattern: string) => {
      const regex = new RegExp('^' + pattern.replace(/\*/g, '.*') + '$');
      return Array.from(store.keys()).filter((k) => regex.test(k));
    }),

    // Set operations
    smembers: vi.fn(async (key: string) => {
      const set = sets.get(key);
      return set ? Array.from(set) : [];
    }),
    sadd: vi.fn(async (key: string, ...members: string[]) => {
      if (!sets.has(key)) sets.set(key, new Set());
      const set = sets.get(key)!;
      let added = 0;
      for (const member of members) {
        if (!set.has(member)) {
          set.add(member);
          added++;
        }
      }
      return added;
    }),
    srem: vi.fn(async (key: string, ...members: string[]) => {
      const set = sets.get(key);
      if (!set) return 0;
      let removed = 0;
      for (const member of members) {
        if (set.delete(member)) removed++;
      }
      return removed;
    }),
    expire: vi.fn(async (key: string, seconds: number) => {
      ttls.set(key, seconds);
      return store.has(key) || sets.has(key) ? 1 : 0;
    }),

    // Pub/Sub
    publish: vi.fn(async () => 1),
    subscribe: vi.fn(async () => undefined),
    unsubscribe: vi.fn(async () => undefined),
    on: vi.fn((event: string, callback: (channel: string, message: string) => void) => {
      if (event === 'message') {
        messageCallbacks.push(callback);
      }
    }),

    // Health
    ping: vi.fn(async () => 'PONG'),

    // Helper to simulate incoming message
    _simulateMessage: (channel: string, message: string) => {
      for (const cb of messageCallbacks) {
        cb(channel, message);
      }
    },
  } as unknown as Redis & {
    store: Map<string, string>;
    sets: Map<string, Set<string>>;
    ttls: Map<string, number>;
  };
}

// Sample data matching shared types
const sampleSession = {
  sessionId: 'session-123',
  mediaServerId: 'server-1',
  userId: 'user-123',
  username: 'testuser',
  title: 'Test Movie',
  mediaType: 'movie' as const,
  state: 'playing' as const,
  progress: 50,
  duration: 7200,
  startTime: Date.now(),
  lastUpdated: Date.now(),
  device: 'Chrome',
  player: 'Web',
  quality: '1080p',
  ipAddress: '192.168.1.100',
};

const sampleStats = {
  activeSessions: 5,
  totalUsers: 100,
  totalServers: 3,
  activeViolations: 2,
  sessionsToday: 25,
  streamsByMediaType: { movie: 10, episode: 15 },
};

describe('CacheService', () => {
  let redis: ReturnType<typeof createMockRedis>;
  let cache: CacheService;

  beforeEach(() => {
    redis = createMockRedis();
    cache = createCacheService(redis);
  });

  describe('getActiveSessions / setActiveSessions', () => {
    it('should return null when no sessions cached', async () => {
      const result = await cache.getActiveSessions();

      expect(result).toBeNull();
      expect(redis.get).toHaveBeenCalledWith('tracearr:sessions:active');
    });

    it('should store and retrieve active sessions', async () => {
      const sessions = [sampleSession] as unknown[];

      await cache.setActiveSessions(sessions as never);
      const result = await cache.getActiveSessions();

      expect(result).toEqual(sessions);
      expect(redis.setex).toHaveBeenCalledWith(
        'tracearr:sessions:active',
        300, // CACHE_TTL.ACTIVE_SESSIONS
        expect.any(String)
      );
    });

    it('should invalidate dashboard stats when setting sessions', async () => {
      await cache.setActiveSessions([sampleSession] as never);

      expect(redis.del).toHaveBeenCalledWith('tracearr:stats:dashboard');
    });

    it('should return null on JSON parse error', async () => {
      redis.store.set('tracearr:sessions:active', 'not-valid-json{');

      const result = await cache.getActiveSessions();

      expect(result).toBeNull();
    });

    it('should handle empty array', async () => {
      await cache.setActiveSessions([]);
      const result = await cache.getActiveSessions();

      expect(result).toEqual([]);
    });
  });

  describe('getDashboardStats / setDashboardStats', () => {
    it('should return null when no stats cached', async () => {
      const result = await cache.getDashboardStats();

      expect(result).toBeNull();
    });

    it('should store and retrieve dashboard stats', async () => {
      await cache.setDashboardStats(sampleStats as any);
      const result = await cache.getDashboardStats();

      expect(result).toEqual(sampleStats);
      expect(redis.setex).toHaveBeenCalledWith(
        'tracearr:stats:dashboard',
        60, // CACHE_TTL.DASHBOARD_STATS
        expect.any(String)
      );
    });

    it('should return null on JSON parse error', async () => {
      redis.store.set('tracearr:stats:dashboard', '{broken');

      const result = await cache.getDashboardStats();

      expect(result).toBeNull();
    });
  });

  describe('getSessionById / setSessionById / deleteSessionById', () => {
    it('should return null for non-existent session', async () => {
      const result = await cache.getSessionById('nonexistent');

      expect(result).toBeNull();
      expect(redis.get).toHaveBeenCalledWith('tracearr:sessions:nonexistent');
    });

    it('should store and retrieve session by ID', async () => {
      await cache.setSessionById('session-123', sampleSession as any);
      const result = await cache.getSessionById('session-123');

      expect(result).toEqual(sampleSession);
    });

    it('should delete session by ID', async () => {
      await cache.setSessionById('session-123', sampleSession as any);
      await cache.deleteSessionById('session-123');

      const result = await cache.getSessionById('session-123');
      expect(result).toBeNull();
    });

    it('should return null on JSON parse error', async () => {
      redis.store.set('tracearr:sessions:session-123', 'invalid-json');

      const result = await cache.getSessionById('session-123');

      expect(result).toBeNull();
    });
  });

  describe('getUserSessions / addUserSession / removeUserSession', () => {
    it('should return null for user with no sessions', async () => {
      const result = await cache.getUserSessions('user-123');

      expect(result).toBeNull();
    });

    it('should add and retrieve user sessions', async () => {
      await cache.addUserSession('user-123', 'session-1');
      await cache.addUserSession('user-123', 'session-2');

      const result = await cache.getUserSessions('user-123');

      expect(result).toContain('session-1');
      expect(result).toContain('session-2');
      expect(result).toHaveLength(2);
    });

    it('should set expiration when adding session', async () => {
      await cache.addUserSession('user-123', 'session-1');

      expect(redis.expire).toHaveBeenCalledWith('tracearr:users:user-123:sessions', 3600);
    });

    it('should remove user session', async () => {
      await cache.addUserSession('user-123', 'session-1');
      await cache.addUserSession('user-123', 'session-2');

      await cache.removeUserSession('user-123', 'session-1');

      const result = await cache.getUserSessions('user-123');
      expect(result).toEqual(['session-2']);
    });

    it('should not add duplicate session IDs', async () => {
      await cache.addUserSession('user-123', 'session-1');
      await cache.addUserSession('user-123', 'session-1');

      const result = await cache.getUserSessions('user-123');
      expect(result).toEqual(['session-1']);
    });
  });

  describe('invalidateCache', () => {
    it('should delete specific key', async () => {
      redis.store.set('some:key', 'value');

      await cache.invalidateCache('some:key');

      expect(redis.del).toHaveBeenCalledWith('some:key');
    });
  });

  describe('invalidatePattern', () => {
    it('should delete all keys matching pattern', async () => {
      redis.store.set('tracearr:sessions:1', 'data1');
      redis.store.set('tracearr:sessions:2', 'data2');
      redis.store.set('tracearr:users:1', 'user1');

      await cache.invalidatePattern('tracearr:sessions:*');

      // del should be called with both session keys
      expect(redis.del).toHaveBeenCalled();
      // Verify keys were found
      expect(redis.keys).toHaveBeenCalledWith('tracearr:sessions:*');
    });

    it('should not call del when no keys match pattern', async () => {
      await cache.invalidatePattern('nonexistent:*');

      expect(redis.keys).toHaveBeenCalledWith('nonexistent:*');
      // del should not be called since no keys matched
      expect(redis.del).not.toHaveBeenCalled();
    });
  });

  describe('ping', () => {
    it('should return true when Redis responds with PONG', async () => {
      const result = await cache.ping();

      expect(result).toBe(true);
      expect(redis.ping).toHaveBeenCalled();
    });

    it('should return false when Redis responds with non-PONG', async () => {
      vi.mocked(redis.ping).mockResolvedValueOnce('ERROR');

      const result = await cache.ping();

      expect(result).toBe(false);
    });

    it('should return false when Redis throws', async () => {
      vi.mocked(redis.ping).mockRejectedValueOnce(new Error('Connection failed'));

      const result = await cache.ping();

      expect(result).toBe(false);
    });
  });
});

describe('PubSubService', () => {
  let publisher: ReturnType<typeof createMockRedis>;
  let subscriber: ReturnType<typeof createMockRedis>;
  let pubsub: PubSubService;

  beforeEach(() => {
    publisher = createMockRedis();
    subscriber = createMockRedis();
    pubsub = createPubSubService(publisher, subscriber);
  });

  describe('publish', () => {
    it('should publish event with data to events channel', async () => {
      const eventData = { userId: 'user-123', action: 'login' };

      await pubsub.publish('user.login', eventData);

      expect(publisher.publish).toHaveBeenCalledWith(
        'tracearr:events',
        expect.stringContaining('"event":"user.login"')
      );
    });

    it('should include timestamp in published message', async () => {
      const before = Date.now();
      await pubsub.publish('test.event', { data: 'test' });
      const after = Date.now();

      const publishCall = vi.mocked(publisher.publish).mock.calls[0];
      const message = JSON.parse(publishCall![1] as string);

      expect(message.timestamp).toBeGreaterThanOrEqual(before);
      expect(message.timestamp).toBeLessThanOrEqual(after);
    });

    it('should stringify complex data structures', async () => {
      const complexData = {
        nested: { array: [1, 2, 3], obj: { key: 'value' } },
        number: 42,
        boolean: true,
      };

      await pubsub.publish('complex.event', complexData);

      const publishCall = vi.mocked(publisher.publish).mock.calls[0];
      const message = JSON.parse(publishCall![1] as string);

      expect(message.data).toEqual(complexData);
    });
  });

  describe('subscribe', () => {
    it('should subscribe to channel', async () => {
      const callback = vi.fn();

      await pubsub.subscribe('test-channel', callback);

      expect(subscriber.subscribe).toHaveBeenCalledWith('test-channel');
    });

    it('should invoke callback when message received', async () => {
      const callback = vi.fn();

      await pubsub.subscribe('test-channel', callback);

      // Simulate incoming message
      (subscriber as any)._simulateMessage('test-channel', '{"test": "data"}');

      expect(callback).toHaveBeenCalledWith('{"test": "data"}');
    });

    it('should route messages to correct callback', async () => {
      const callback1 = vi.fn();
      const callback2 = vi.fn();

      await pubsub.subscribe('channel-1', callback1);
      await pubsub.subscribe('channel-2', callback2);

      (subscriber as any)._simulateMessage('channel-1', 'message-1');
      (subscriber as any)._simulateMessage('channel-2', 'message-2');

      expect(callback1).toHaveBeenCalledWith('message-1');
      expect(callback2).toHaveBeenCalledWith('message-2');
      expect(callback1).not.toHaveBeenCalledWith('message-2');
      expect(callback2).not.toHaveBeenCalledWith('message-1');
    });

    it('should not invoke callback for unsubscribed channel', async () => {
      const callback = vi.fn();

      await pubsub.subscribe('subscribed-channel', callback);

      (subscriber as any)._simulateMessage('other-channel', 'message');

      expect(callback).not.toHaveBeenCalled();
    });
  });

  describe('unsubscribe', () => {
    it('should unsubscribe from channel', async () => {
      const callback = vi.fn();

      await pubsub.subscribe('test-channel', callback);
      await pubsub.unsubscribe('test-channel');

      expect(subscriber.unsubscribe).toHaveBeenCalledWith('test-channel');
    });

    it('should not invoke callback after unsubscribe', async () => {
      const callback = vi.fn();

      await pubsub.subscribe('test-channel', callback);
      await pubsub.unsubscribe('test-channel');

      (subscriber as any)._simulateMessage('test-channel', 'message');

      expect(callback).not.toHaveBeenCalled();
    });
  });

  describe('getPubSubService', () => {
    it('should return the created pubsub instance', () => {
      const result = getPubSubService();

      expect(result).toBe(pubsub);
    });
  });
});
