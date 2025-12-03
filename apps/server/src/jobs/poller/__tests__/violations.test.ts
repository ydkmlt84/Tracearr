/**
 * Violations Module Tests
 *
 * Tests rule/violation functions from poller/violations.ts:
 * - getTrustScorePenalty: Map violation severity to trust score penalty
 * - doesRuleApplyToUser: Check if a rule applies to a specific user
 */

import { describe, it, expect } from 'vitest';
import { randomUUID } from 'node:crypto';
import { getTrustScorePenalty, doesRuleApplyToUser } from '../violations.js';

describe('getTrustScorePenalty', () => {
  describe('severity mapping', () => {
    it('should return 20 for HIGH severity', () => {
      expect(getTrustScorePenalty('high')).toBe(20);
    });

    it('should return 10 for WARNING severity', () => {
      expect(getTrustScorePenalty('warning')).toBe(10);
    });

    it('should return 5 for LOW severity', () => {
      expect(getTrustScorePenalty('low')).toBe(5);
    });
  });
});

describe('doesRuleApplyToUser', () => {
  describe('global rules', () => {
    it('should apply global rules (serverUserId=null) to any user', () => {
      const globalRule = { serverUserId: null };
      expect(doesRuleApplyToUser(globalRule, randomUUID())).toBe(true);
      expect(doesRuleApplyToUser(globalRule, randomUUID())).toBe(true);
    });
  });

  describe('user-specific rules', () => {
    it('should apply user-specific rule only to that user', () => {
      const targetServerUserId = randomUUID();
      const otherServerUserId = randomUUID();
      const userRule = { serverUserId: targetServerUserId };

      expect(doesRuleApplyToUser(userRule, targetServerUserId)).toBe(true);
      expect(doesRuleApplyToUser(userRule, otherServerUserId)).toBe(false);
    });
  });
});
