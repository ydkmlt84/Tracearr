/**
 * Tests for Issue #92: Device Velocity groupByDevice option
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { RuleEngine } from '../rules.js';
import { createMockSession, createMockRule } from '../../test/fixtures.js';

function createSessionWithDevice(
  serverUserId: string,
  deviceId: string | null,
  ip: string,
  hoursAgo: number = 0
) {
  return createMockSession({
    serverUserId,
    deviceId,
    ipAddress: ip,
    geoCity: 'New York',
    geoRegion: 'New York',
    geoCountry: 'US',
    geoLat: 40.7128,
    geoLon: -74.006,
    startedAt: new Date(Date.now() - hoursAgo * 60 * 60 * 1000),
  });
}

describe('RuleEngine - Device Velocity Group By Device (Issue #92)', () => {
  let ruleEngine: RuleEngine;
  const serverUserId = 'user-123';

  beforeEach(() => {
    ruleEngine = new RuleEngine();
  });

  describe('with groupByDevice: false (default behavior)', () => {
    it('should count each unique IP regardless of device', async () => {
      const recentSessions = [
        createSessionWithDevice(serverUserId, 'shield-123', '192.168.1.100', 1),
        createSessionWithDevice(serverUserId, 'shield-123', '192.168.1.101', 2),
        createSessionWithDevice(serverUserId, 'shield-123', '192.168.1.102', 3),
      ];

      const currentSession = createSessionWithDevice(serverUserId, 'shield-123', '192.168.1.103');

      const rule = createMockRule('device_velocity', {
        params: { maxIps: 3, windowHours: 24, groupByDevice: false },
      });

      const results = await ruleEngine.evaluateSession(currentSession, [rule], recentSessions);

      expect(results).toHaveLength(1);
      expect(results[0]!.violated).toBe(true);
      expect(results[0]!.data.uniqueIpCount).toBe(4);
    });
  });

  describe('with groupByDevice: true', () => {
    it('should count same device as 1 source regardless of IP changes', async () => {
      const recentSessions = [
        createSessionWithDevice(serverUserId, 'shield-123', '192.168.1.100', 1),
        createSessionWithDevice(serverUserId, 'shield-123', '192.168.1.101', 2),
        createSessionWithDevice(serverUserId, 'shield-123', '192.168.1.102', 3),
      ];

      const currentSession = createSessionWithDevice(serverUserId, 'shield-123', '192.168.1.103');

      const rule = createMockRule('device_velocity', {
        params: { maxIps: 3, windowHours: 24, groupByDevice: true },
      });

      const results = await ruleEngine.evaluateSession(currentSession, [rule], recentSessions);

      expect(results).toHaveLength(0);
    });

    it('should count multiple devices as separate sources', async () => {
      const recentSessions = [
        createSessionWithDevice(serverUserId, 'shield-123', '192.168.1.100', 1),
        createSessionWithDevice(serverUserId, 'iphone-456', '192.168.1.101', 2),
        createSessionWithDevice(serverUserId, 'laptop-789', '192.168.1.102', 3),
      ];

      const currentSession = createSessionWithDevice(serverUserId, 'tablet-012', '192.168.1.103');

      const rule = createMockRule('device_velocity', {
        params: { maxIps: 3, windowHours: 24, groupByDevice: true },
      });

      const results = await ruleEngine.evaluateSession(currentSession, [rule], recentSessions);

      expect(results).toHaveLength(1);
      expect(results[0]!.violated).toBe(true);
      expect(results[0]!.data.uniqueIpCount).toBe(4);
      expect(results[0]!.data.groupedByDevice).toBe(true);
    });

    it('should handle Virtual Channel scenario - same device, IP variation', async () => {
      // Virtual Channel transitions with different IPs but same deviceId
      const recentSessions = [
        createSessionWithDevice(serverUserId, 'emby-virtual-channel', '192.168.1.50', 1),
        createSessionWithDevice(serverUserId, 'emby-virtual-channel', '127.0.0.1', 2),
        createSessionWithDevice(serverUserId, 'emby-virtual-channel', '192.168.1.50', 3),
        createSessionWithDevice(serverUserId, 'emby-virtual-channel', '10.0.0.5', 4),
      ];

      const currentSession = createSessionWithDevice(
        serverUserId,
        'emby-virtual-channel',
        '172.16.0.1'
      );

      const rule = createMockRule('device_velocity', {
        params: { maxIps: 2, windowHours: 24, groupByDevice: true },
      });

      const results = await ruleEngine.evaluateSession(currentSession, [rule], recentSessions);

      expect(results).toHaveLength(0);
    });

    it('should fall back to IP for sessions without deviceId', async () => {
      const recentSessions = [
        createSessionWithDevice(serverUserId, 'shield-123', '192.168.1.100', 1),
        createSessionWithDevice(serverUserId, null, '192.168.1.101', 2),
        createSessionWithDevice(serverUserId, null, '192.168.1.102', 3),
      ];

      const currentSession = createSessionWithDevice(serverUserId, null, '192.168.1.103');

      const rule = createMockRule('device_velocity', {
        params: { maxIps: 3, windowHours: 24, groupByDevice: true },
      });

      const results = await ruleEngine.evaluateSession(currentSession, [rule], recentSessions);

      // 1 device + 3 IPs without deviceId = 4 sources
      expect(results).toHaveLength(1);
      expect(results[0]!.violated).toBe(true);
      expect(results[0]!.data.uniqueIpCount).toBe(4);
    });

    it('should combine groupByDevice with excludePrivateIps', async () => {
      const recentSessions = [
        createSessionWithDevice(serverUserId, 'shield-123', '192.168.1.100', 1),
        createSessionWithDevice(serverUserId, 'iphone-456', '192.168.1.101', 2),
        createSessionWithDevice(serverUserId, 'laptop-789', '10.0.0.5', 3),
      ];

      const currentSession = createSessionWithDevice(serverUserId, 'tablet-012', '172.16.0.1');

      const rule = createMockRule('device_velocity', {
        params: { maxIps: 2, windowHours: 24, groupByDevice: true, excludePrivateIps: true },
      });

      const results = await ruleEngine.evaluateSession(currentSession, [rule], recentSessions);

      expect(results).toHaveLength(0);
    });

    it('should include groupedByDevice flag in violation data', async () => {
      const recentSessions = [
        createSessionWithDevice(serverUserId, 'device-1', '8.8.8.1', 1),
        createSessionWithDevice(serverUserId, 'device-2', '8.8.8.2', 2),
        createSessionWithDevice(serverUserId, 'device-3', '8.8.8.3', 3),
      ];

      const currentSession = createSessionWithDevice(serverUserId, 'device-4', '8.8.8.4');

      const rule = createMockRule('device_velocity', {
        params: { maxIps: 3, windowHours: 24, groupByDevice: true },
      });

      const results = await ruleEngine.evaluateSession(currentSession, [rule], recentSessions);

      expect(results).toHaveLength(1);
      expect(results[0]!.data.groupedByDevice).toBe(true);
    });

    it('should still report all unique IPs in violation data', async () => {
      const recentSessions = [
        createSessionWithDevice(serverUserId, 'device-1', '8.8.8.1', 1),
        createSessionWithDevice(serverUserId, 'device-1', '8.8.8.2', 2),
        createSessionWithDevice(serverUserId, 'device-2', '8.8.8.3', 3),
      ];

      const currentSession = createSessionWithDevice(serverUserId, 'device-3', '8.8.8.4');

      const rule = createMockRule('device_velocity', {
        params: { maxIps: 2, windowHours: 24, groupByDevice: true },
      });

      const results = await ruleEngine.evaluateSession(currentSession, [rule], recentSessions);

      expect(results).toHaveLength(1);
      expect(results[0]!.data.uniqueIpCount).toBe(3);
      expect(results[0]!.data.ips).toHaveLength(4);
      expect(results[0]!.data.ips).toContain('8.8.8.1');
      expect(results[0]!.data.ips).toContain('8.8.8.2');
      expect(results[0]!.data.ips).toContain('8.8.8.3');
      expect(results[0]!.data.ips).toContain('8.8.8.4');
    });
  });

  describe('backwards compatibility', () => {
    it('should work without groupByDevice param (defaults to false)', async () => {
      const recentSessions = [
        createSessionWithDevice(serverUserId, 'shield-123', '192.168.1.100', 1),
        createSessionWithDevice(serverUserId, 'shield-123', '192.168.1.101', 2),
      ];

      const currentSession = createSessionWithDevice(serverUserId, 'shield-123', '192.168.1.102');

      const rule = createMockRule('device_velocity', {
        params: { maxIps: 2, windowHours: 24 },
      });

      const results = await ruleEngine.evaluateSession(currentSession, [rule], recentSessions);

      expect(results).toHaveLength(1);
      expect(results[0]!.violated).toBe(true);
      expect(results[0]!.data.uniqueIpCount).toBe(3);
      expect(results[0]!.data.groupedByDevice).toBeUndefined();
    });
  });
});
