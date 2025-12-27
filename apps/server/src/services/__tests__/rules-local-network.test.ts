/**
 * TDD Tests for Issue #82: Local Network Access Should Not Trigger Violations
 *
 * These tests validate that:
 * 1. Sessions from local/private IPs (with null coordinates) should not trigger impossible_travel
 * 2. Sessions from local/private IPs should not trigger simultaneous_locations
 * 3. Sessions with geoCountry='Local Network' should not trigger geo_restriction
 * 4. Switching between remote and local access on the same device should be safe
 *
 * Scenario from issue:
 * - User accesses media server remotely via FQDN/reverse proxy (gets external IP, valid location)
 * - User accesses media server locally via local IP (gets private IP, no location)
 * - Switching between these should NOT trigger "Sharing Violation Detected"
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { RuleEngine } from '../rules.js';
import { createMockSession, createMockRule, TEST_LOCATIONS } from '../../test/fixtures.js';

/**
 * Helper to create a session mimicking local network access
 * (private IP, no geo coordinates, geoCountry='Local Network')
 */
function createLocalNetworkSession(
  overrides: Partial<Parameters<typeof createMockSession>[0]> = {}
) {
  return createMockSession({
    ipAddress: '192.168.1.100',
    geoCity: null,
    geoRegion: null,
    geoCountry: 'Local Network',
    geoLat: null,
    geoLon: null,
    ...overrides,
  });
}

/**
 * Helper to create a session mimicking remote access via reverse proxy
 * (public IP, valid geo coordinates)
 */
function createRemoteSession(
  location: keyof typeof TEST_LOCATIONS = 'newYork',
  overrides: Partial<Parameters<typeof createMockSession>[0]> = {}
) {
  const loc = TEST_LOCATIONS[location];
  return createMockSession({
    ipAddress: '203.0.113.50', // Public IP
    geoCity: loc.city,
    geoRegion: loc.region,
    geoCountry: loc.country,
    geoLat: loc.lat,
    geoLon: loc.lon,
    ...overrides,
  });
}

describe('RuleEngine - Local Network Access (Issue #82)', () => {
  let ruleEngine: RuleEngine;

  beforeEach(() => {
    ruleEngine = new RuleEngine();
  });

  describe('impossible_travel with local network sessions', () => {
    const serverUserId = 'user-123';

    it('should NOT violate when current session is from local network (null coords)', async () => {
      // Scenario: User was watching remotely, now watching locally
      const remoteSession = createRemoteSession('london', {
        serverUserId,
        startedAt: new Date(Date.now() - 30 * 60 * 1000), // 30 min ago
      });

      const localSession = createLocalNetworkSession({
        serverUserId,
        startedAt: new Date(),
      });

      const rule = createMockRule('impossible_travel', {
        params: { maxSpeedKmh: 500 },
      });

      const results = await ruleEngine.evaluateSession(localSession, [rule], [remoteSession]);

      expect(results).toHaveLength(0);
    });

    it('should NOT violate when previous session is from local network (null coords)', async () => {
      // Scenario: User was watching locally, now watching remotely
      const localSession = createLocalNetworkSession({
        serverUserId,
        startedAt: new Date(Date.now() - 30 * 60 * 1000), // 30 min ago
      });

      const remoteSession = createRemoteSession('tokyo', {
        serverUserId,
        startedAt: new Date(),
      });

      const rule = createMockRule('impossible_travel', {
        params: { maxSpeedKmh: 500 },
      });

      const results = await ruleEngine.evaluateSession(remoteSession, [rule], [localSession]);

      expect(results).toHaveLength(0);
    });

    it('should NOT violate when switching between remote and local on SAME device', async () => {
      // Scenario: Same device accesses remotely then locally
      const deviceId = 'same-device-123';

      const remoteSession = createRemoteSession('london', {
        serverUserId,
        deviceId,
        startedAt: new Date(Date.now() - 10 * 60 * 1000), // 10 min ago
      });

      const localSession = createLocalNetworkSession({
        serverUserId,
        deviceId,
        startedAt: new Date(),
      });

      const rule = createMockRule('impossible_travel', {
        params: { maxSpeedKmh: 500 },
      });

      const results = await ruleEngine.evaluateSession(localSession, [rule], [remoteSession]);

      expect(results).toHaveLength(0);
    });

    it('should correctly compare TWO remote sessions even if local session exists', async () => {
      // Scenario: User has local + 2 remote sessions; remote sessions should be compared
      // Remote 1 (NYC) -> Remote 2 (Tokyo) in 30 min = impossible travel
      const localSession = createLocalNetworkSession({
        serverUserId,
        startedAt: new Date(Date.now() - 60 * 60 * 1000), // 1 hour ago (oldest)
      });

      const remoteNYC = createRemoteSession('newYork', {
        serverUserId,
        startedAt: new Date(Date.now() - 30 * 60 * 1000), // 30 min ago
        deviceId: 'device-nyc',
      });

      const remoteTokyo = createRemoteSession('tokyo', {
        serverUserId,
        startedAt: new Date(), // Now
        deviceId: 'device-tokyo',
      });

      const rule = createMockRule('impossible_travel', {
        params: { maxSpeedKmh: 500 },
      });

      // Evaluate the Tokyo session - should find violation comparing to NYC (not local)
      const results = await ruleEngine.evaluateSession(
        remoteTokyo,
        [rule],
        [localSession, remoteNYC]
      );

      // NYC to Tokyo is ~10,850 km, in 30 min = ~21,700 km/h >> 500 km/h
      expect(results).toHaveLength(1);
      expect(results[0]!.violated).toBe(true);
      expect(results[0]!.data.previousLocation).toEqual({
        lat: TEST_LOCATIONS.newYork.lat,
        lon: TEST_LOCATIONS.newYork.lon,
      });
    });
  });

  describe('simultaneous_locations with local network sessions', () => {
    const serverUserId = 'user-456';

    it('should NOT violate when current session is from local network', async () => {
      const remoteSession = createRemoteSession('london', {
        serverUserId,
        state: 'playing',
        stoppedAt: null,
      });

      const localSession = createLocalNetworkSession({
        serverUserId,
        state: 'playing',
        stoppedAt: null,
      });

      const rule = createMockRule('simultaneous_locations', {
        params: { minDistanceKm: 100 },
      });

      const results = await ruleEngine.evaluateSession(localSession, [rule], [remoteSession]);

      expect(results).toHaveLength(0);
    });

    it('should NOT violate when remote session evaluates against local session', async () => {
      const localSession = createLocalNetworkSession({
        serverUserId,
        state: 'playing',
        stoppedAt: null,
      });

      const remoteSession = createRemoteSession('tokyo', {
        serverUserId,
        state: 'playing',
        stoppedAt: null,
      });

      const rule = createMockRule('simultaneous_locations', {
        params: { minDistanceKm: 100 },
      });

      const results = await ruleEngine.evaluateSession(remoteSession, [rule], [localSession]);

      expect(results).toHaveLength(0);
    });

    it('should correctly detect violations between TWO remote sessions', async () => {
      // Two remote sessions playing simultaneously in different locations
      const remoteNYC = createRemoteSession('newYork', {
        serverUserId,
        state: 'playing',
        stoppedAt: null,
        deviceId: 'device-nyc',
      });

      const remoteLondon = createRemoteSession('london', {
        serverUserId,
        state: 'playing',
        stoppedAt: null,
        deviceId: 'device-london',
      });

      const rule = createMockRule('simultaneous_locations', {
        params: { minDistanceKm: 100 },
      });

      const results = await ruleEngine.evaluateSession(remoteLondon, [rule], [remoteNYC]);

      expect(results).toHaveLength(1);
      expect(results[0]!.violated).toBe(true);
    });
  });

  describe('geo_restriction with local network sessions', () => {
    it('should NOT violate for Local Network in allowlist mode', async () => {
      const localSession = createLocalNetworkSession({
        geoCountry: 'Local Network',
      });

      const rule = createMockRule('geo_restriction', {
        params: { mode: 'allowlist', countries: ['US', 'CA', 'GB'] },
      });

      const results = await ruleEngine.evaluateSession(localSession, [rule], []);

      expect(results).toHaveLength(0);
    });

    it('should NOT violate for Local Network in blocklist mode', async () => {
      const localSession = createLocalNetworkSession({
        geoCountry: 'Local Network',
      });

      const rule = createMockRule('geo_restriction', {
        params: { mode: 'blocklist', countries: ['CN', 'RU', 'KP'] },
      });

      const results = await ruleEngine.evaluateSession(localSession, [rule], []);

      expect(results).toHaveLength(0);
    });

    it('should NOT violate for Local Network even if explicitly in blocklist', async () => {
      // Edge case: someone adds "Local Network" to blocklist
      const localSession = createLocalNetworkSession({
        geoCountry: 'Local Network',
      });

      const rule = createMockRule('geo_restriction', {
        params: { mode: 'blocklist', countries: ['Local Network', 'CN'] },
      });

      const results = await ruleEngine.evaluateSession(localSession, [rule], []);

      expect(results).toHaveLength(0);
    });
  });

  describe('device_velocity with local network sessions', () => {
    const serverUserId = 'user-789';

    it('should count local IPs same as public IPs (current behavior)', async () => {
      // This test documents current behavior - device_velocity counts ALL IPs
      // Note: This might be the source of Issue #82 if user has many local IPs
      const recentSessions = [
        createLocalNetworkSession({
          serverUserId,
          ipAddress: '192.168.1.100',
          startedAt: new Date(Date.now() - 1 * 60 * 60 * 1000),
        }),
        createLocalNetworkSession({
          serverUserId,
          ipAddress: '192.168.1.101',
          startedAt: new Date(Date.now() - 2 * 60 * 60 * 1000),
        }),
        createRemoteSession('london', {
          serverUserId,
          ipAddress: '203.0.113.50',
          startedAt: new Date(Date.now() - 3 * 60 * 60 * 1000),
        }),
      ];

      const currentSession = createLocalNetworkSession({
        serverUserId,
        ipAddress: '192.168.1.102', // New local IP
      });

      const rule = createMockRule('device_velocity', {
        params: { maxIps: 3, windowHours: 24 },
      });

      const results = await ruleEngine.evaluateSession(currentSession, [rule], recentSessions);

      // 4 unique IPs (3 local + 1 remote) > maxIps of 3 → VIOLATION
      expect(results).toHaveLength(1);
      expect(results[0]!.violated).toBe(true);
      expect(results[0]!.data.uniqueIpCount).toBe(4);
    });

    it('should NOT violate when same local IP is reused', async () => {
      // Same local IP across sessions should not count as multiple IPs
      const recentSessions = [
        createLocalNetworkSession({
          serverUserId,
          ipAddress: '192.168.1.100', // Same IP
          startedAt: new Date(Date.now() - 1 * 60 * 60 * 1000),
        }),
        createLocalNetworkSession({
          serverUserId,
          ipAddress: '192.168.1.100', // Same IP
          startedAt: new Date(Date.now() - 2 * 60 * 60 * 1000),
        }),
      ];

      const currentSession = createLocalNetworkSession({
        serverUserId,
        ipAddress: '192.168.1.100', // Same IP again
      });

      const rule = createMockRule('device_velocity', {
        params: { maxIps: 3, windowHours: 24 },
      });

      const results = await ruleEngine.evaluateSession(currentSession, [rule], recentSessions);

      // Only 1 unique IP, not a violation
      expect(results).toHaveLength(0);
    });
  });

  describe('concurrent_streams with local network sessions', () => {
    const serverUserId = 'user-concurrent';

    it('should count local sessions toward concurrent stream limit', async () => {
      // concurrent_streams is location-agnostic - counts all active streams
      const localSession1 = createLocalNetworkSession({
        serverUserId,
        state: 'playing',
        stoppedAt: null,
        deviceId: 'device-1',
      });

      const localSession2 = createLocalNetworkSession({
        serverUserId,
        state: 'playing',
        stoppedAt: null,
        deviceId: 'device-2',
      });

      const currentSession = createRemoteSession('london', {
        serverUserId,
        state: 'playing',
        stoppedAt: null,
        deviceId: 'device-current',
      });

      const rule = createMockRule('concurrent_streams', {
        params: { maxStreams: 2 },
      });

      const results = await ruleEngine.evaluateSession(
        currentSession,
        [rule],
        [localSession1, localSession2]
      );

      // 3 active streams > maxStreams of 2 → VIOLATION
      expect(results).toHaveLength(1);
      expect(results[0]!.violated).toBe(true);
      expect(results[0]!.data.activeStreamCount).toBe(3);
    });
  });

  describe('edge cases', () => {
    const serverUserId = 'user-edge';

    it('should handle coordinates of (0, 0) as valid location (Gulf of Guinea)', async () => {
      // Coordinates (0, 0) are valid - point in the ocean off Africa
      // This should NOT be treated as null coordinates
      const sessionAtZeroZero = createMockSession({
        serverUserId,
        geoLat: 0,
        geoLon: 0,
        geoCountry: 'Unknown',
        startedAt: new Date(Date.now() - 10 * 60 * 1000),
        deviceId: 'device-zero',
      });

      const sessionInNYC = createRemoteSession('newYork', {
        serverUserId,
        startedAt: new Date(),
        deviceId: 'device-nyc',
      });

      const rule = createMockRule('impossible_travel', {
        params: { maxSpeedKmh: 500 },
      });

      const results = await ruleEngine.evaluateSession(sessionInNYC, [rule], [sessionAtZeroZero]);

      // (0,0) to NYC is ~8,000 km, in 10 min = ~48,000 km/h >> 500 km/h
      // This SHOULD trigger because (0, 0) is a valid location
      expect(results).toHaveLength(1);
      expect(results[0]!.violated).toBe(true);
    });

    it('should handle null deviceId correctly (cannot exclude same device)', async () => {
      // If deviceId is null on one or both sessions, we can't confirm same device
      const remoteSession = createRemoteSession('london', {
        serverUserId,
        deviceId: null, // Unknown device
        startedAt: new Date(Date.now() - 5 * 60 * 1000),
      });

      const localSession = createLocalNetworkSession({
        serverUserId,
        deviceId: 'known-device', // Different (or could be same, we don't know)
        startedAt: new Date(),
      });

      const rule = createMockRule('impossible_travel', {
        params: { maxSpeedKmh: 500 },
      });

      const results = await ruleEngine.evaluateSession(localSession, [rule], [remoteSession]);

      // Should not trigger because local session has null coordinates
      expect(results).toHaveLength(0);
    });
  });
});
