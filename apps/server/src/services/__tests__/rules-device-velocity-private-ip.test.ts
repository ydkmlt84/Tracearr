/**
 * TDD Tests for Issue #82: Device Velocity Should Optionally Exclude Private IPs
 *
 * The device_velocity rule counts unique IPs in a time window. Currently it counts
 * private/local IPs the same as public IPs. This can cause false positives when a user:
 * - Uses multiple local devices (each with different 192.168.x.x IP)
 * - Has DHCP lease changes
 * - Uses both local and remote access
 *
 * This test suite validates a new `excludePrivateIps` option that allows users to
 * configure whether private IPs should be counted toward the unique IP limit.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { RuleEngine } from '../rules.js';
import { createMockSession, createMockRule } from '../../test/fixtures.js';

/**
 * Helper to create a session with a private IP
 */
function createPrivateIpSession(serverUserId: string, ip: string, hoursAgo: number = 0) {
  return createMockSession({
    serverUserId,
    ipAddress: ip,
    geoCity: null,
    geoRegion: null,
    geoCountry: 'Local Network',
    geoLat: null,
    geoLon: null,
    startedAt: new Date(Date.now() - hoursAgo * 60 * 60 * 1000),
  });
}

/**
 * Helper to create a session with a public IP
 */
function createPublicIpSession(serverUserId: string, ip: string, hoursAgo: number = 0) {
  return createMockSession({
    serverUserId,
    ipAddress: ip,
    geoCity: 'New York',
    geoRegion: 'New York',
    geoCountry: 'US',
    geoLat: 40.7128,
    geoLon: -74.006,
    startedAt: new Date(Date.now() - hoursAgo * 60 * 60 * 1000),
  });
}

describe('RuleEngine - Device Velocity Private IP Exclusion (Issue #82)', () => {
  let ruleEngine: RuleEngine;
  const serverUserId = 'user-123';

  beforeEach(() => {
    ruleEngine = new RuleEngine();
  });

  describe('with excludePrivateIps: false (default, current behavior)', () => {
    it('should count private IPs toward unique IP limit', async () => {
      const recentSessions = [
        createPrivateIpSession(serverUserId, '192.168.1.100', 1),
        createPrivateIpSession(serverUserId, '192.168.1.101', 2),
        createPublicIpSession(serverUserId, '203.0.113.50', 3),
      ];

      const currentSession = createPrivateIpSession(serverUserId, '192.168.1.102');

      const rule = createMockRule('device_velocity', {
        params: { maxIps: 3, windowHours: 24, excludePrivateIps: false },
      });

      const results = await ruleEngine.evaluateSession(currentSession, [rule], recentSessions);

      // 4 unique IPs (3 private + 1 public) > maxIps of 3 → VIOLATION
      expect(results).toHaveLength(1);
      expect(results[0]!.violated).toBe(true);
      expect(results[0]!.data.uniqueIpCount).toBe(4);
    });
  });

  describe('with excludePrivateIps: true (new option for Issue #82)', () => {
    it('should NOT count private IPs toward unique IP limit', async () => {
      const recentSessions = [
        createPrivateIpSession(serverUserId, '192.168.1.100', 1),
        createPrivateIpSession(serverUserId, '192.168.1.101', 2),
        createPublicIpSession(serverUserId, '203.0.113.50', 3),
      ];

      const currentSession = createPrivateIpSession(serverUserId, '192.168.1.102');

      const rule = createMockRule('device_velocity', {
        params: { maxIps: 3, windowHours: 24, excludePrivateIps: true },
      });

      const results = await ruleEngine.evaluateSession(currentSession, [rule], recentSessions);

      // Only 1 public IP (private IPs excluded) ≤ maxIps of 3 → NO VIOLATION
      expect(results).toHaveLength(0);
    });

    it('should still count public IPs toward limit', async () => {
      const recentSessions = [
        createPublicIpSession(serverUserId, '203.0.113.1', 1),
        createPublicIpSession(serverUserId, '203.0.113.2', 2),
        createPublicIpSession(serverUserId, '203.0.113.3', 3),
        createPrivateIpSession(serverUserId, '192.168.1.100', 4), // Should be excluded
      ];

      const currentSession = createPublicIpSession(serverUserId, '203.0.113.4');

      const rule = createMockRule('device_velocity', {
        params: { maxIps: 3, windowHours: 24, excludePrivateIps: true },
      });

      const results = await ruleEngine.evaluateSession(currentSession, [rule], recentSessions);

      // 4 public IPs (private excluded) > maxIps of 3 → VIOLATION
      expect(results).toHaveLength(1);
      expect(results[0]!.violated).toBe(true);
      expect(results[0]!.data.uniqueIpCount).toBe(4);
    });

    it('should handle IPv6 private addresses', async () => {
      const recentSessions = [
        createPrivateIpSession(serverUserId, 'fe80::1', 1), // Link-local IPv6
        createPrivateIpSession(serverUserId, 'fd00::1', 2), // ULA IPv6
        createPrivateIpSession(serverUserId, '::1', 3), // Loopback IPv6
        createPublicIpSession(serverUserId, '2001:db8::1', 4), // Public IPv6 (documentation range, but treat as public)
      ];

      const currentSession = createPublicIpSession(serverUserId, '203.0.113.50');

      const rule = createMockRule('device_velocity', {
        params: { maxIps: 3, windowHours: 24, excludePrivateIps: true },
      });

      const results = await ruleEngine.evaluateSession(currentSession, [rule], recentSessions);

      // Only 2 public IPs (1 IPv6 + 1 IPv4), private IPv6 excluded → NO VIOLATION
      expect(results).toHaveLength(0);
    });

    it('should handle ::ffff: mapped IPv4 private addresses', async () => {
      const recentSessions = [
        createPrivateIpSession(serverUserId, '::ffff:192.168.1.1', 1), // Mapped private IPv4
        createPrivateIpSession(serverUserId, '::ffff:10.0.0.1', 2), // Mapped private IPv4
        createPublicIpSession(serverUserId, '::ffff:203.0.113.1', 3), // Mapped public IPv4
      ];

      const currentSession = createPublicIpSession(serverUserId, '203.0.113.50');

      const rule = createMockRule('device_velocity', {
        params: { maxIps: 2, windowHours: 24, excludePrivateIps: true },
      });

      const results = await ruleEngine.evaluateSession(currentSession, [rule], recentSessions);

      // Only 2 public IPs → NO VIOLATION (exactly at limit)
      expect(results).toHaveLength(0);
    });

    it('should still report private IPs in violation data when mixed with public', async () => {
      // Even when excluding private IPs from the count, the violation data should
      // include information about all IPs for transparency
      const recentSessions = [
        createPrivateIpSession(serverUserId, '192.168.1.100', 1),
        createPublicIpSession(serverUserId, '203.0.113.1', 2),
        createPublicIpSession(serverUserId, '203.0.113.2', 3),
        createPublicIpSession(serverUserId, '203.0.113.3', 4),
      ];

      const currentSession = createPublicIpSession(serverUserId, '203.0.113.4');

      const rule = createMockRule('device_velocity', {
        params: { maxIps: 3, windowHours: 24, excludePrivateIps: true },
      });

      const results = await ruleEngine.evaluateSession(currentSession, [rule], recentSessions);

      // 4 public IPs > maxIps of 3 → VIOLATION
      expect(results).toHaveLength(1);
      expect(results[0]!.data.uniqueIpCount).toBe(4); // Only public IPs counted
      // The actual IPs in the data should only show public IPs
      expect(results[0]!.data.ips).not.toContain('192.168.1.100');
    });
  });

  describe('backwards compatibility', () => {
    it('should work without excludePrivateIps param (defaults to false)', async () => {
      const recentSessions = [
        createPrivateIpSession(serverUserId, '192.168.1.100', 1),
        createPrivateIpSession(serverUserId, '192.168.1.101', 2),
      ];

      const currentSession = createPrivateIpSession(serverUserId, '192.168.1.102');

      // Old-style params without excludePrivateIps
      const rule = createMockRule('device_velocity', {
        params: { maxIps: 2, windowHours: 24 },
      });

      const results = await ruleEngine.evaluateSession(currentSession, [rule], recentSessions);

      // 3 IPs > maxIps of 2 → VIOLATION (backwards compatible behavior)
      expect(results).toHaveLength(1);
      expect(results[0]!.violated).toBe(true);
    });
  });
});
