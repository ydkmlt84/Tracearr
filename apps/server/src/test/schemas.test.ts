/**
 * Zod schema validation tests for rules and violations
 *
 * Tests validation behavior for:
 * - Rule creation/update schemas
 * - Rule parameter schemas for all 5 rule types
 * - Violation query schema
 */

import { describe, it, expect } from 'vitest';
import {
  createRuleSchema,
  updateRuleSchema,
  ruleIdParamSchema,
  impossibleTravelParamsSchema,
  simultaneousLocationsParamsSchema,
  deviceVelocityParamsSchema,
  concurrentStreamsParamsSchema,
  geoRestrictionParamsSchema,
  violationQuerySchema,
  violationIdParamSchema,
} from '@tracearr/shared';
import { randomUUID } from 'node:crypto';

describe('Rule Schemas', () => {
  describe('createRuleSchema', () => {
    it('should validate a valid rule creation request', () => {
      const input = {
        name: 'Test Rule',
        type: 'impossible_travel',
        params: { maxSpeedKmh: 500 },
      };

      const result = createRuleSchema.safeParse(input);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.name).toBe('Test Rule');
        expect(result.data.type).toBe('impossible_travel');
        expect(result.data.serverUserId).toBeNull(); // Default
        expect(result.data.isActive).toBe(true); // Default
      }
    });

    it('should apply default values', () => {
      const input = {
        name: 'Test Rule',
        type: 'concurrent_streams',
        params: { maxStreams: 3 },
      };

      const result = createRuleSchema.safeParse(input);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.serverUserId).toBeNull();
        expect(result.data.isActive).toBe(true);
      }
    });

    it('should accept valid serverUserId', () => {
      const serverUserId = randomUUID();
      const input = {
        name: 'User Rule',
        type: 'geo_restriction',
        params: { blockedCountries: ['CN'] },
        serverUserId,
      };

      const result = createRuleSchema.safeParse(input);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.serverUserId).toBe(serverUserId);
      }
    });

    it('should accept null serverUserId for global rules', () => {
      const input = {
        name: 'Global Rule',
        type: 'device_velocity',
        params: { maxIps: 5, windowHours: 24 },
        serverUserId: null,
      };

      const result = createRuleSchema.safeParse(input);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.serverUserId).toBeNull();
      }
    });

    it('should reject empty name', () => {
      const input = {
        name: '',
        type: 'concurrent_streams',
        params: {},
      };

      const result = createRuleSchema.safeParse(input);
      expect(result.success).toBe(false);
    });

    it('should reject name over 100 characters', () => {
      const input = {
        name: 'a'.repeat(101),
        type: 'concurrent_streams',
        params: {},
      };

      const result = createRuleSchema.safeParse(input);
      expect(result.success).toBe(false);
    });

    it('should reject invalid rule type', () => {
      const input = {
        name: 'Test Rule',
        type: 'invalid_type',
        params: {},
      };

      const result = createRuleSchema.safeParse(input);
      expect(result.success).toBe(false);
    });

    it('should validate all 5 rule types', () => {
      const types = [
        'impossible_travel',
        'simultaneous_locations',
        'device_velocity',
        'concurrent_streams',
        'geo_restriction',
      ];

      for (const type of types) {
        const input = {
          name: `Test ${type}`,
          type,
          params: {},
        };

        const result = createRuleSchema.safeParse(input);
        expect(result.success).toBe(true);
      }
    });

    it('should reject missing required fields', () => {
      const inputs = [
        { type: 'concurrent_streams', params: {} }, // missing name
        { name: 'Test', params: {} }, // missing type
        { name: 'Test', type: 'concurrent_streams' }, // missing params
      ];

      for (const input of inputs) {
        const result = createRuleSchema.safeParse(input);
        expect(result.success).toBe(false);
      }
    });

    it('should reject invalid serverUserId format', () => {
      const input = {
        name: 'Test Rule',
        type: 'concurrent_streams',
        params: {},
        serverUserId: 'not-a-uuid',
      };

      const result = createRuleSchema.safeParse(input);
      expect(result.success).toBe(false);
    });
  });

  describe('updateRuleSchema', () => {
    it('should validate partial updates', () => {
      const input = { name: 'Updated Name' };
      const result = updateRuleSchema.safeParse(input);
      expect(result.success).toBe(true);
    });

    it('should allow empty object (no updates)', () => {
      const result = updateRuleSchema.safeParse({});
      expect(result.success).toBe(true);
    });

    it('should validate isActive update', () => {
      const result = updateRuleSchema.safeParse({ isActive: false });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.isActive).toBe(false);
      }
    });

    it('should validate params update', () => {
      const result = updateRuleSchema.safeParse({
        params: { maxStreams: 5 },
      });
      expect(result.success).toBe(true);
    });

    it('should validate combined updates', () => {
      const result = updateRuleSchema.safeParse({
        name: 'New Name',
        params: { maxSpeedKmh: 1000 },
        isActive: false,
      });
      expect(result.success).toBe(true);
    });

    it('should reject empty name', () => {
      const result = updateRuleSchema.safeParse({ name: '' });
      expect(result.success).toBe(false);
    });

    it('should reject name over 100 characters', () => {
      const result = updateRuleSchema.safeParse({ name: 'a'.repeat(101) });
      expect(result.success).toBe(false);
    });
  });

  describe('ruleIdParamSchema', () => {
    it('should validate valid UUID', () => {
      const result = ruleIdParamSchema.safeParse({ id: randomUUID() });
      expect(result.success).toBe(true);
    });

    it('should reject invalid UUID', () => {
      const result = ruleIdParamSchema.safeParse({ id: 'not-a-uuid' });
      expect(result.success).toBe(false);
    });

    it('should reject missing id', () => {
      const result = ruleIdParamSchema.safeParse({});
      expect(result.success).toBe(false);
    });
  });
});

describe('Rule Parameter Schemas', () => {
  describe('impossibleTravelParamsSchema', () => {
    it('should validate with custom maxSpeedKmh', () => {
      const result = impossibleTravelParamsSchema.safeParse({
        maxSpeedKmh: 1000,
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.maxSpeedKmh).toBe(1000);
      }
    });

    it('should apply default maxSpeedKmh', () => {
      const result = impossibleTravelParamsSchema.safeParse({});
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.maxSpeedKmh).toBe(500);
      }
    });

    it('should accept ignoreVpnRanges', () => {
      const result = impossibleTravelParamsSchema.safeParse({
        maxSpeedKmh: 500,
        ignoreVpnRanges: true,
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.ignoreVpnRanges).toBe(true);
      }
    });

    it('should reject non-positive maxSpeedKmh', () => {
      const invalidValues = [0, -100];
      for (const val of invalidValues) {
        const result = impossibleTravelParamsSchema.safeParse({
          maxSpeedKmh: val,
        });
        expect(result.success).toBe(false);
      }
    });
  });

  describe('simultaneousLocationsParamsSchema', () => {
    it('should validate with custom minDistanceKm', () => {
      const result = simultaneousLocationsParamsSchema.safeParse({
        minDistanceKm: 200,
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.minDistanceKm).toBe(200);
      }
    });

    it('should apply default minDistanceKm', () => {
      const result = simultaneousLocationsParamsSchema.safeParse({});
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.minDistanceKm).toBe(100);
      }
    });

    it('should reject non-positive minDistanceKm', () => {
      const result = simultaneousLocationsParamsSchema.safeParse({
        minDistanceKm: 0,
      });
      expect(result.success).toBe(false);
    });
  });

  describe('deviceVelocityParamsSchema', () => {
    it('should validate with custom values', () => {
      const result = deviceVelocityParamsSchema.safeParse({
        maxIps: 10,
        windowHours: 48,
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.maxIps).toBe(10);
        expect(result.data.windowHours).toBe(48);
      }
    });

    it('should apply defaults', () => {
      const result = deviceVelocityParamsSchema.safeParse({});
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.maxIps).toBe(5);
        expect(result.data.windowHours).toBe(24);
      }
    });

    it('should reject non-positive maxIps', () => {
      const result = deviceVelocityParamsSchema.safeParse({
        maxIps: 0,
        windowHours: 24,
      });
      expect(result.success).toBe(false);
    });

    it('should reject non-positive windowHours', () => {
      const result = deviceVelocityParamsSchema.safeParse({
        maxIps: 5,
        windowHours: 0,
      });
      expect(result.success).toBe(false);
    });

    it('should reject non-integer values', () => {
      const result = deviceVelocityParamsSchema.safeParse({
        maxIps: 5.5,
        windowHours: 24.7,
      });
      expect(result.success).toBe(false);
    });
  });

  describe('concurrentStreamsParamsSchema', () => {
    it('should validate with custom maxStreams', () => {
      const result = concurrentStreamsParamsSchema.safeParse({
        maxStreams: 5,
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.maxStreams).toBe(5);
      }
    });

    it('should apply default maxStreams', () => {
      const result = concurrentStreamsParamsSchema.safeParse({});
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.maxStreams).toBe(3);
      }
    });

    it('should reject non-positive maxStreams', () => {
      const result = concurrentStreamsParamsSchema.safeParse({
        maxStreams: 0,
      });
      expect(result.success).toBe(false);
    });

    it('should reject non-integer maxStreams', () => {
      const result = concurrentStreamsParamsSchema.safeParse({
        maxStreams: 3.5,
      });
      expect(result.success).toBe(false);
    });
  });

  describe('geoRestrictionParamsSchema', () => {
    it('should validate with blocked countries', () => {
      const result = geoRestrictionParamsSchema.safeParse({
        blockedCountries: ['CN', 'RU', 'KP'],
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.blockedCountries).toEqual(['CN', 'RU', 'KP']);
      }
    });

    it('should apply empty default for blockedCountries', () => {
      const result = geoRestrictionParamsSchema.safeParse({});
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.blockedCountries).toEqual([]);
      }
    });

    it('should reject country codes that are not 2 characters', () => {
      const invalidInputs = [
        { blockedCountries: ['USA'] }, // 3 chars
        { blockedCountries: ['C'] }, // 1 char
        { blockedCountries: ['CHINA'] }, // 5 chars
      ];

      for (const input of invalidInputs) {
        const result = geoRestrictionParamsSchema.safeParse(input);
        expect(result.success).toBe(false);
      }
    });

    it('should allow empty array', () => {
      const result = geoRestrictionParamsSchema.safeParse({
        blockedCountries: [],
      });
      expect(result.success).toBe(true);
    });
  });
});

describe('Violation Schemas', () => {
  describe('violationQuerySchema', () => {
    it('should validate empty query (defaults)', () => {
      const result = violationQuerySchema.safeParse({});
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.page).toBe(1);
        expect(result.data.pageSize).toBe(20);
      }
    });

    it('should validate pagination params', () => {
      const result = violationQuerySchema.safeParse({
        page: 5,
        pageSize: 50,
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.page).toBe(5);
        expect(result.data.pageSize).toBe(50);
      }
    });

    it('should coerce string numbers', () => {
      const result = violationQuerySchema.safeParse({
        page: '3',
        pageSize: '25',
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.page).toBe(3);
        expect(result.data.pageSize).toBe(25);
      }
    });

    it('should validate serverUserId filter', () => {
      const serverUserId = randomUUID();
      const result = violationQuerySchema.safeParse({ serverUserId });
      expect(result.success).toBe(true);
    });

    it('should validate ruleId filter', () => {
      const ruleId = randomUUID();
      const result = violationQuerySchema.safeParse({ ruleId });
      expect(result.success).toBe(true);
    });

    it('should validate severity filter', () => {
      const severities = ['low', 'warning', 'high'];
      for (const severity of severities) {
        const result = violationQuerySchema.safeParse({ severity });
        expect(result.success).toBe(true);
      }
    });

    it('should reject invalid severity', () => {
      const result = violationQuerySchema.safeParse({
        severity: 'critical',
      });
      expect(result.success).toBe(false);
    });

    it('should validate acknowledged filter', () => {
      const results = [
        violationQuerySchema.safeParse({ acknowledged: true }),
        violationQuerySchema.safeParse({ acknowledged: false }),
        violationQuerySchema.safeParse({ acknowledged: 'true' }), // coercion
        violationQuerySchema.safeParse({ acknowledged: 'false' }), // coercion
      ];

      for (const result of results) {
        expect(result.success).toBe(true);
      }
    });

    it('should validate date filters', () => {
      const result = violationQuerySchema.safeParse({
        startDate: '2024-01-01',
        endDate: '2024-12-31',
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.startDate).toBeInstanceOf(Date);
        expect(result.data.endDate).toBeInstanceOf(Date);
      }
    });

    it('should reject pageSize over 100', () => {
      const result = violationQuerySchema.safeParse({
        pageSize: 101,
      });
      expect(result.success).toBe(false);
    });

    it('should reject non-positive page', () => {
      const result = violationQuerySchema.safeParse({
        page: 0,
      });
      expect(result.success).toBe(false);
    });
  });

  describe('violationIdParamSchema', () => {
    it('should validate valid UUID', () => {
      const result = violationIdParamSchema.safeParse({ id: randomUUID() });
      expect(result.success).toBe(true);
    });

    it('should reject invalid UUID', () => {
      const result = violationIdParamSchema.safeParse({ id: 'invalid' });
      expect(result.success).toBe(false);
    });
  });
});
