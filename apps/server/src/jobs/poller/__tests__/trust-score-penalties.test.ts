/**
 * Trust Score Penalty Tests
 *
 * Tests for trust score penalty calculation and stacking behavior
 * when multiple violations are created for the same session/user.
 *
 * Current behavior: Penalties stack (each violation deducts independently)
 * This test documents that behavior and provides a foundation for
 * future changes if penalty dampening is desired.
 */

import { describe, it, expect } from 'vitest';
import { getTrustScorePenalty } from '../violations.js';
import type { ViolationSeverity } from '@tracearr/shared';

describe('Trust Score Penalties', () => {
  describe('getTrustScorePenalty - individual penalties', () => {
    it('should return 20 for high severity', () => {
      expect(getTrustScorePenalty('high')).toBe(20);
    });

    it('should return 10 for warning severity', () => {
      expect(getTrustScorePenalty('warning')).toBe(10);
    });

    it('should return 5 for low severity', () => {
      expect(getTrustScorePenalty('low')).toBe(5);
    });
  });

  describe('penalty stacking behavior (documentation tests)', () => {
    /**
     * These tests document the current stacking behavior where
     * multiple violations result in cumulative penalties.
     */

    it('should calculate cumulative penalty for multiple violations of same severity', () => {
      const violations: ViolationSeverity[] = ['high', 'high', 'high'];
      const totalPenalty = violations.reduce((sum, sev) => sum + getTrustScorePenalty(sev), 0);

      // 3 high violations = 60 points (20 * 3)
      expect(totalPenalty).toBe(60);
    });

    it('should calculate cumulative penalty for mixed severity violations', () => {
      const violations: ViolationSeverity[] = ['high', 'warning', 'low'];
      const totalPenalty = violations.reduce((sum, sev) => sum + getTrustScorePenalty(sev), 0);

      // 1 high (20) + 1 warning (10) + 1 low (5) = 35
      expect(totalPenalty).toBe(35);
    });

    it('should document max possible penalty from all 5 rule types', () => {
      // Worst case: user triggers all 5 rule types on one session
      // geo_restriction: high (20)
      // impossible_travel: high (20)
      // simultaneous_locations: warning (10)
      // device_velocity: warning (10)
      // concurrent_streams: low (5)
      const allRuleViolations: ViolationSeverity[] = ['high', 'high', 'warning', 'warning', 'low'];
      const totalPenalty = allRuleViolations.reduce(
        (sum, sev) => sum + getTrustScorePenalty(sev),
        0
      );

      // Total: 65 points from a single session
      expect(totalPenalty).toBe(65);
    });

    it('should document penalty for duplicate rules of same type', () => {
      // If user has 2 geo_restriction rules that both trigger
      const duplicateHighViolations: ViolationSeverity[] = ['high', 'high'];
      const totalPenalty = duplicateHighViolations.reduce(
        (sum, sev) => sum + getTrustScorePenalty(sev),
        0
      );

      // 2 high violations = 40 points
      expect(totalPenalty).toBe(40);
    });
  });

  describe('trust score bounds', () => {
    /**
     * Trust score is clamped to 0 minimum in the database update:
     * GREATEST(0, ${serverUsers.trustScore} - ${trustPenalty})
     */

    it('should document that trust score cannot go below 0', () => {
      // Starting trust score of 100, penalty of 120 should result in 0
      const startingScore = 100;
      const penalty = 120; // More than starting score

      const resultScore = Math.max(0, startingScore - penalty);
      expect(resultScore).toBe(0);
    });

    it('should document penalty impact on low trust score user', () => {
      // User with trust score of 15 gets a high violation
      const startingScore = 15;
      const penalty = getTrustScorePenalty('high'); // 20

      const resultScore = Math.max(0, startingScore - penalty);
      expect(resultScore).toBe(0); // Clamped at 0
    });
  });

  describe('penalty scenarios (integration documentation)', () => {
    /**
     * These tests document real-world scenarios to help understand
     * the impact of the current stacking behavior.
     */

    it('scenario: legitimate user with VPN triggers geo + impossible_travel', () => {
      // User connects via VPN, appears in blocked country AND
      // triggers impossible_travel from previous session
      const penalties = [
        getTrustScorePenalty('high'), // geo_restriction
        getTrustScorePenalty('high'), // impossible_travel
      ];
      const totalPenalty = penalties.reduce((a, b) => a + b, 0);

      // Total: 40 points deducted for what might be legitimate VPN use
      expect(totalPenalty).toBe(40);
    });

    it('scenario: family sharing triggers concurrent + simultaneous', () => {
      // Family members watching at same time from different locations
      const penalties = [
        getTrustScorePenalty('low'), // concurrent_streams
        getTrustScorePenalty('warning'), // simultaneous_locations
      ];
      const totalPenalty = penalties.reduce((a, b) => a + b, 0);

      // Total: 15 points for legitimate family sharing
      expect(totalPenalty).toBe(15);
    });

    it('scenario: account sharing triggers all velocity rules', () => {
      // Account shared across many locations/IPs
      const penalties = [
        getTrustScorePenalty('high'), // impossible_travel
        getTrustScorePenalty('warning'), // simultaneous_locations
        getTrustScorePenalty('warning'), // device_velocity
        getTrustScorePenalty('low'), // concurrent_streams
      ];
      const totalPenalty = penalties.reduce((a, b) => a + b, 0);

      // Total: 45 points - significant penalty for likely account sharing
      expect(totalPenalty).toBe(45);
    });

    it('scenario: rapid session creation triggers same rule multiple times', () => {
      // Without deduplication, rapid sessions could trigger same rule repeatedly
      // With deduplication (now implemented), this is prevented
      // This test documents what WOULD happen without deduplication
      const rapidViolations: ViolationSeverity[] = ['low', 'low', 'low', 'low', 'low'];
      const totalPenalty = rapidViolations.reduce((sum, sev) => sum + getTrustScorePenalty(sev), 0);

      // 5 low violations = 25 points (but deduplication prevents this)
      expect(totalPenalty).toBe(25);
    });
  });

  describe('penalty dampening considerations (future enhancement)', () => {
    /**
     * These tests document potential future enhancements for
     * penalty dampening to prevent unfair cumulative penalties.
     */

    it('should document potential max-penalty-per-session approach', () => {
      // Future: Cap total penalty per session at max single violation
      const MAX_PENALTY_PER_SESSION = 20; // Same as high severity

      const violations: ViolationSeverity[] = ['high', 'high', 'warning'];
      const uncappedPenalty = violations.reduce((sum, sev) => sum + getTrustScorePenalty(sev), 0);
      const cappedPenalty = Math.min(uncappedPenalty, MAX_PENALTY_PER_SESSION);

      expect(uncappedPenalty).toBe(50); // Current behavior
      expect(cappedPenalty).toBe(20); // Potential future behavior
    });

    it('should document potential highest-severity-only approach', () => {
      // Future: Only apply the highest severity penalty per session
      const violations: ViolationSeverity[] = ['high', 'warning', 'low'];
      const penalties = violations.map(getTrustScorePenalty);

      const currentBehavior = penalties.reduce((a, b) => a + b, 0);
      const highestOnlyBehavior = Math.max(...penalties);

      expect(currentBehavior).toBe(35); // Current: sum all
      expect(highestOnlyBehavior).toBe(20); // Potential: highest only
    });

    it('should document potential diminishing-returns approach', () => {
      // Future: Each additional violation has reduced impact
      // First: 100%, Second: 50%, Third: 25%, etc.
      const violations: ViolationSeverity[] = ['high', 'high', 'high'];
      const penalties = violations.map(getTrustScorePenalty);

      const currentBehavior = penalties.reduce((a, b) => a + b, 0);
      const diminishingBehavior = penalties.reduce((sum, penalty, index) => {
        const multiplier = 1 / Math.pow(2, index); // 1, 0.5, 0.25, ...
        return sum + penalty * multiplier;
      }, 0);

      expect(currentBehavior).toBe(60); // Current: 20 + 20 + 20
      expect(diminishingBehavior).toBe(35); // Potential: 20 + 10 + 5
    });
  });
});
