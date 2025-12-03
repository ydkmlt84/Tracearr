/**
 * Violation Handling
 *
 * Functions for creating violations, calculating trust score penalties,
 * and determining rule applicability.
 */

import { eq, sql } from 'drizzle-orm';
import type { Rule, ViolationSeverity, ViolationWithDetails } from '@tracearr/shared';
import { WS_EVENTS } from '@tracearr/shared';
import { db } from '../../db/client.js';
import { serverUsers, violations } from '../../db/schema.js';
import type { RuleEvaluationResult } from '../../services/rules.js';
import type { PubSubService } from '../../services/cache.js';

// ============================================================================
// Trust Score Calculation
// ============================================================================

/**
 * Calculate trust score penalty based on violation severity.
 *
 * @param severity - Violation severity level
 * @returns Trust score penalty (negative value to subtract)
 *
 * @example
 * getTrustScorePenalty('high');    // 20
 * getTrustScorePenalty('warning'); // 10
 * getTrustScorePenalty('low');     // 5
 */
export function getTrustScorePenalty(severity: ViolationSeverity): number {
  return severity === 'high' ? 20 : severity === 'warning' ? 10 : 5;
}

// ============================================================================
// Rule Applicability
// ============================================================================

/**
 * Check if a rule applies to a specific server user.
 *
 * Global rules (serverUserId=null) apply to all server users.
 * User-specific rules only apply to that server user.
 *
 * @param rule - Rule to check
 * @param serverUserId - Server user ID to check against
 * @returns true if the rule applies to this server user
 *
 * @example
 * doesRuleApplyToUser({ serverUserId: null }, 'su-123');       // true (global rule)
 * doesRuleApplyToUser({ serverUserId: 'su-123' }, 'su-123'); // true (user-specific)
 * doesRuleApplyToUser({ serverUserId: 'su-456' }, 'su-123'); // false (different user)
 */
export function doesRuleApplyToUser(
  rule: { serverUserId: string | null },
  serverUserId: string
): boolean {
  return rule.serverUserId === null || rule.serverUserId === serverUserId;
}

// ============================================================================
// Violation Creation
// ============================================================================

/**
 * Create a violation from rule evaluation result.
 * Uses a transaction to ensure violation insert and trust score update are atomic.
 *
 * @param ruleId - ID of the rule that was violated
 * @param serverUserId - ID of the server user who violated the rule
 * @param sessionId - ID of the session where violation occurred
 * @param result - Rule evaluation result with severity and data
 * @param rule - Full rule object for broadcast details
 * @param pubSubService - Optional pub/sub service for WebSocket broadcast
 *
 * @example
 * await createViolation(
 *   'rule-123',
 *   'server-user-456',
 *   'session-789',
 *   { violated: true, severity: 'warning', data: { reason: 'Multiple streams' } },
 *   rule,
 *   pubSubService
 * );
 */
export async function createViolation(
  ruleId: string,
  serverUserId: string,
  sessionId: string,
  result: RuleEvaluationResult,
  rule: Rule,
  pubSubService: PubSubService | null
): Promise<void> {
  // Calculate trust penalty based on severity
  const trustPenalty = getTrustScorePenalty(result.severity);

  // Use transaction to ensure violation creation and trust score update are atomic
  const created = await db.transaction(async (tx) => {
    const [violation] = await tx
      .insert(violations)
      .values({
        ruleId,
        serverUserId,
        sessionId,
        severity: result.severity,
        data: result.data,
      })
      .returning();

    // Decrease server user trust score based on severity (atomic within transaction)
    await tx
      .update(serverUsers)
      .set({
        trustScore: sql`GREATEST(0, ${serverUsers.trustScore} - ${trustPenalty})`,
        updatedAt: new Date(),
      })
      .where(eq(serverUsers.id, serverUserId));

    return violation;
  });

  // Get server user details for the violation broadcast (outside transaction - read only)
  const [serverUser] = await db
    .select({
      id: serverUsers.id,
      username: serverUsers.username,
      thumbUrl: serverUsers.thumbUrl,
    })
    .from(serverUsers)
    .where(eq(serverUsers.id, serverUserId))
    .limit(1);

  // Publish violation event for WebSocket broadcast
  if (pubSubService && created && serverUser) {
    const violationWithDetails: ViolationWithDetails = {
      id: created.id,
      ruleId: created.ruleId,
      serverUserId: created.serverUserId,
      sessionId: created.sessionId,
      severity: created.severity,
      data: created.data,
      acknowledgedAt: created.acknowledgedAt,
      createdAt: created.createdAt,
      user: {
        id: serverUser.id,
        username: serverUser.username,
        thumbUrl: serverUser.thumbUrl,
      },
      rule: {
        id: rule.id,
        name: rule.name,
        type: rule.type,
      },
    };

    await pubSubService.publish(WS_EVENTS.VIOLATION_NEW, violationWithDetails);
    console.log(`[Poller] Violation broadcast: ${rule.name} for user ${serverUser.username}`);
  }
}
