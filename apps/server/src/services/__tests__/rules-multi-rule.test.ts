/**
 * Tests for Multi-Rule Scenarios
 *
 * These tests validate behavior when multiple rules are evaluated against
 * the same session, including:
 * - Multiple rules of the same type
 * - Multiple rules of different types
 * - Rule evaluation order
 * - Combined violations
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { RuleEngine } from '../rules.js';
import { createMockSession, createMockRule } from '../../test/fixtures.js';
import type { Rule } from '@tracearr/shared';

describe('RuleEngine - Multi-Rule Scenarios', () => {
  let ruleEngine: RuleEngine;
  const serverUserId = 'user-123';

  beforeEach(() => {
    ruleEngine = new RuleEngine();
  });

  describe('multiple rules of different types', () => {
    it('should return violations from all triggered rules', async () => {
      // Session that violates both geo_restriction AND concurrent_streams
      const currentSession = createMockSession({
        serverUserId,
        geoCountry: 'RU', // Blocked country
        state: 'playing',
        stoppedAt: null,
        deviceId: 'device-1',
      });

      const activeSession = createMockSession({
        serverUserId,
        state: 'playing',
        stoppedAt: null,
        deviceId: 'device-2',
      });

      const rules: Rule[] = [
        createMockRule('geo_restriction', {
          id: 'rule-geo',
          params: { mode: 'blocklist', countries: ['RU', 'CN'] },
        }),
        createMockRule('concurrent_streams', {
          id: 'rule-concurrent',
          params: { maxStreams: 1 },
        }),
      ];

      const results = await ruleEngine.evaluateSession(currentSession, rules, [activeSession]);

      expect(results).toHaveLength(2);
      expect(results.map((r) => r.rule?.type).sort()).toEqual([
        'concurrent_streams',
        'geo_restriction',
      ]);
    });

    it('should include correct rule reference for each violation', async () => {
      const currentSession = createMockSession({
        serverUserId,
        geoCountry: 'RU',
        state: 'playing',
        stoppedAt: null,
        deviceId: 'device-1',
      });

      const activeSession = createMockSession({
        serverUserId,
        state: 'playing',
        stoppedAt: null,
        deviceId: 'device-2',
      });

      const geoRule = createMockRule('geo_restriction', {
        id: 'rule-geo',
        name: 'Block Russia',
        params: { mode: 'blocklist', countries: ['RU'] },
      });

      const concurrentRule = createMockRule('concurrent_streams', {
        id: 'rule-concurrent',
        name: 'Max 1 Stream',
        params: { maxStreams: 1 },
      });

      const results = await ruleEngine.evaluateSession(currentSession, [geoRule, concurrentRule], [
        activeSession,
      ]);

      const geoViolation = results.find((r) => r.rule?.type === 'geo_restriction');
      const concurrentViolation = results.find((r) => r.rule?.type === 'concurrent_streams');

      expect(geoViolation?.rule?.id).toBe('rule-geo');
      expect(geoViolation?.rule?.name).toBe('Block Russia');

      expect(concurrentViolation?.rule?.id).toBe('rule-concurrent');
      expect(concurrentViolation?.rule?.name).toBe('Max 1 Stream');
    });
  });

  describe('multiple rules of the same type', () => {
    it('should evaluate all rules of same type and return all violations', async () => {
      // Two geo_restriction rules with different countries blocked
      const currentSession = createMockSession({
        serverUserId,
        geoCountry: 'RU',
        state: 'playing',
      });

      const rules: Rule[] = [
        createMockRule('geo_restriction', {
          id: 'rule-geo-1',
          name: 'Block Russia',
          params: { mode: 'blocklist', countries: ['RU'] },
        }),
        createMockRule('geo_restriction', {
          id: 'rule-geo-2',
          name: 'Block Eastern Europe',
          params: { mode: 'blocklist', countries: ['RU', 'UA', 'BY'] },
        }),
      ];

      const results = await ruleEngine.evaluateSession(currentSession, rules, []);

      // Both rules should trigger for RU
      expect(results).toHaveLength(2);
      expect(results[0]?.rule?.id).toBe('rule-geo-1');
      expect(results[1]?.rule?.id).toBe('rule-geo-2');
    });

    it('should only return violations from rules that actually trigger', async () => {
      const currentSession = createMockSession({
        serverUserId,
        geoCountry: 'DE', // Germany - only in one blocklist
        state: 'playing',
      });

      const rules: Rule[] = [
        createMockRule('geo_restriction', {
          id: 'rule-geo-1',
          name: 'Block Russia',
          params: { mode: 'blocklist', countries: ['RU'] },
        }),
        createMockRule('geo_restriction', {
          id: 'rule-geo-2',
          name: 'Block EU',
          params: { mode: 'blocklist', countries: ['DE', 'FR', 'IT'] },
        }),
      ];

      const results = await ruleEngine.evaluateSession(currentSession, rules, []);

      // Only the EU rule should trigger for DE
      expect(results).toHaveLength(1);
      expect(results[0]?.rule?.id).toBe('rule-geo-2');
    });

    it('should handle multiple concurrent_streams rules with different limits', async () => {
      const currentSession = createMockSession({
        serverUserId,
        state: 'playing',
        stoppedAt: null,
        deviceId: 'device-1',
      });

      // 2 active sessions = 3 total with current
      const activeSessions = [
        createMockSession({
          serverUserId,
          state: 'playing',
          stoppedAt: null,
          deviceId: 'device-2',
        }),
        createMockSession({
          serverUserId,
          state: 'playing',
          stoppedAt: null,
          deviceId: 'device-3',
        }),
      ];

      const rules: Rule[] = [
        createMockRule('concurrent_streams', {
          id: 'rule-strict',
          name: 'Strict - Max 1',
          params: { maxStreams: 1 },
        }),
        createMockRule('concurrent_streams', {
          id: 'rule-lenient',
          name: 'Lenient - Max 5',
          params: { maxStreams: 5 },
        }),
      ];

      const results = await ruleEngine.evaluateSession(currentSession, rules, activeSessions);

      // Only the strict rule should trigger (3 streams > 1, but 3 streams < 5)
      expect(results).toHaveLength(1);
      expect(results[0]?.rule?.id).toBe('rule-strict');
    });
  });

  describe('rule applicability (global vs user-specific)', () => {
    it('should apply global rules to all users', async () => {
      const currentSession = createMockSession({
        serverUserId: 'any-user',
        geoCountry: 'RU',
      });

      const globalRule = createMockRule('geo_restriction', {
        serverUserId: null, // Global rule
        params: { mode: 'blocklist', countries: ['RU'] },
      });

      const results = await ruleEngine.evaluateSession(currentSession, [globalRule], []);

      expect(results).toHaveLength(1);
    });

    it('should only apply user-specific rules to matching users', async () => {
      const currentSession = createMockSession({
        serverUserId: 'user-123',
        geoCountry: 'RU',
      });

      const rules: Rule[] = [
        createMockRule('geo_restriction', {
          id: 'rule-for-123',
          serverUserId: 'user-123', // Matches
          params: { mode: 'blocklist', countries: ['RU'] },
        }),
        createMockRule('geo_restriction', {
          id: 'rule-for-456',
          serverUserId: 'user-456', // Doesn't match
          params: { mode: 'blocklist', countries: ['RU'] },
        }),
      ];

      const results = await ruleEngine.evaluateSession(currentSession, rules, []);

      expect(results).toHaveLength(1);
      expect(results[0]?.rule?.id).toBe('rule-for-123');
    });

    it('should apply both global and matching user-specific rules', async () => {
      const currentSession = createMockSession({
        serverUserId: 'user-123',
        geoCountry: 'RU',
      });

      const rules: Rule[] = [
        createMockRule('geo_restriction', {
          id: 'rule-global',
          serverUserId: null, // Global
          params: { mode: 'blocklist', countries: ['RU'] },
        }),
        createMockRule('geo_restriction', {
          id: 'rule-user',
          serverUserId: 'user-123', // User-specific
          params: { mode: 'blocklist', countries: ['RU'] },
        }),
      ];

      const results = await ruleEngine.evaluateSession(currentSession, rules, []);

      // Both should trigger
      expect(results).toHaveLength(2);
    });
  });

  describe('severity levels from multiple violations', () => {
    it('should preserve individual severity for each violation', async () => {
      const currentSession = createMockSession({
        serverUserId,
        geoCountry: 'RU',
        state: 'playing',
        stoppedAt: null,
        deviceId: 'device-1',
      });

      const activeSession = createMockSession({
        serverUserId,
        state: 'playing',
        stoppedAt: null,
        deviceId: 'device-2',
      });

      const rules: Rule[] = [
        createMockRule('geo_restriction', {
          params: { mode: 'blocklist', countries: ['RU'] },
        }),
        createMockRule('concurrent_streams', {
          params: { maxStreams: 1 },
        }),
      ];

      const results = await ruleEngine.evaluateSession(currentSession, rules, [activeSession]);

      const geoViolation = results.find((r) => r.rule?.type === 'geo_restriction');
      const concurrentViolation = results.find((r) => r.rule?.type === 'concurrent_streams');

      // geo_restriction is 'high', concurrent_streams is 'low'
      expect(geoViolation?.severity).toBe('high');
      expect(concurrentViolation?.severity).toBe('low');
    });
  });

  describe('rule evaluation order', () => {
    it('should evaluate rules in the order they are provided', async () => {
      const currentSession = createMockSession({
        serverUserId,
        geoCountry: 'RU',
      });

      const _evaluationOrder: string[] = [];

      // Create rules with tracking
      const rules: Rule[] = [
        createMockRule('geo_restriction', {
          id: 'first',
          params: { mode: 'blocklist', countries: ['RU'] },
        }),
        createMockRule('geo_restriction', {
          id: 'second',
          params: { mode: 'blocklist', countries: ['RU'] },
        }),
        createMockRule('geo_restriction', {
          id: 'third',
          params: { mode: 'blocklist', countries: ['RU'] },
        }),
      ];

      const results = await ruleEngine.evaluateSession(currentSession, rules, []);

      // Results should be in same order as rules
      expect(results.map((r) => r.rule?.id)).toEqual(['first', 'second', 'third']);
    });
  });

  describe('excludePrivateIps interaction with multiple rules', () => {
    it('should respect excludePrivateIps setting independently per rule', async () => {
      const localSession = createMockSession({
        serverUserId,
        ipAddress: '192.168.1.100',
        geoCountry: 'Local Network',
        state: 'playing',
        stoppedAt: null,
        deviceId: 'device-1',
      });

      const activeSession = createMockSession({
        serverUserId,
        ipAddress: '203.0.113.50',
        geoCountry: 'US',
        state: 'playing',
        stoppedAt: null,
        deviceId: 'device-2',
      });

      const rules: Rule[] = [
        createMockRule('concurrent_streams', {
          id: 'rule-exclude-private',
          params: { maxStreams: 1, excludePrivateIps: true },
        }),
        createMockRule('concurrent_streams', {
          id: 'rule-count-all',
          params: { maxStreams: 1, excludePrivateIps: false },
        }),
      ];

      const results = await ruleEngine.evaluateSession(localSession, rules, [activeSession]);

      // Only the rule without excludePrivateIps should trigger
      // (the local session is excluded from the first rule's count)
      expect(results).toHaveLength(1);
      expect(results[0]?.rule?.id).toBe('rule-count-all');
    });
  });

  describe('edge cases', () => {
    it('should return empty array when no rules are provided', async () => {
      const session = createMockSession({ serverUserId });
      const results = await ruleEngine.evaluateSession(session, [], []);
      expect(results).toHaveLength(0);
    });

    it('should return empty array when no rules trigger', async () => {
      const session = createMockSession({
        serverUserId,
        geoCountry: 'US', // Not blocked
      });

      const rules = [
        createMockRule('geo_restriction', {
          params: { mode: 'blocklist', countries: ['RU', 'CN'] },
        }),
      ];

      const results = await ruleEngine.evaluateSession(session, rules, []);
      expect(results).toHaveLength(0);
    });

    it('should handle all 5 rule types triggering simultaneously', async () => {
      // Create a session that violates all 5 rule types
      const currentSession = createMockSession({
        serverUserId,
        ipAddress: '203.0.113.1',
        geoCountry: 'RU', // Blocked
        geoLat: 55.7558,
        geoLon: 37.6173, // Moscow
        state: 'playing',
        stoppedAt: null,
        deviceId: 'device-current',
        startedAt: new Date(),
      });

      // Previous session far away (for impossible_travel)
      const previousSession = createMockSession({
        serverUserId,
        ipAddress: '198.51.100.1',
        geoCountry: 'US',
        geoLat: 40.7128,
        geoLon: -74.006, // NYC
        state: 'playing',
        stoppedAt: null,
        deviceId: 'device-prev',
        startedAt: new Date(Date.now() - 60 * 60 * 1000), // 1 hour ago
      });

      // Multiple sessions from different IPs (for device_velocity)
      const recentSessions = [
        previousSession,
        createMockSession({
          serverUserId,
          ipAddress: '198.51.100.2',
          startedAt: new Date(Date.now() - 2 * 60 * 60 * 1000),
        }),
        createMockSession({
          serverUserId,
          ipAddress: '198.51.100.3',
          startedAt: new Date(Date.now() - 3 * 60 * 60 * 1000),
        }),
        createMockSession({
          serverUserId,
          ipAddress: '198.51.100.4',
          startedAt: new Date(Date.now() - 4 * 60 * 60 * 1000),
        }),
        createMockSession({
          serverUserId,
          ipAddress: '198.51.100.5',
          startedAt: new Date(Date.now() - 5 * 60 * 60 * 1000),
        }),
        createMockSession({
          serverUserId,
          ipAddress: '198.51.100.6',
          startedAt: new Date(Date.now() - 6 * 60 * 60 * 1000),
        }),
      ];

      const rules: Rule[] = [
        createMockRule('impossible_travel', {
          params: { maxSpeedKmh: 500 }, // NYC to Moscow in 1 hour = impossible
        }),
        createMockRule('simultaneous_locations', {
          params: { minDistanceKm: 100 },
        }),
        createMockRule('device_velocity', {
          params: { maxIps: 3, windowHours: 24 }, // 7 IPs > 3
        }),
        createMockRule('concurrent_streams', {
          params: { maxStreams: 1 }, // 2 playing > 1
        }),
        createMockRule('geo_restriction', {
          params: { mode: 'blocklist', countries: ['RU'] },
        }),
      ];

      const results = await ruleEngine.evaluateSession(currentSession, rules, recentSessions);

      // All 5 rules should trigger
      const triggeredTypes = results.map((r) => r.rule?.type).sort();
      expect(triggeredTypes).toEqual([
        'concurrent_streams',
        'device_velocity',
        'geo_restriction',
        'impossible_travel',
        'simultaneous_locations',
      ]);
    });
  });
});
