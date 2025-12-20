/**
 * Stress Test Setup
 *
 * Minimal setup for stress tests. Unlike unit tests, stress tests use
 * the REAL database from environment variables (.env file) to measure
 * actual query performance and index effectiveness.
 *
 * Requirements:
 * - DATABASE_URL set in .env or environment
 * - PostgreSQL running with the tracearr schema
 */

import { beforeAll, afterAll } from 'vitest';

// Validate required environment
beforeAll(() => {
  if (!process.env.DATABASE_URL) {
    throw new Error(
      'DATABASE_URL is required for stress tests. Run from project root with: ' +
        'pnpm --filter @tracearr/server test:stress'
    );
  }

  console.log('\n🔧 Stress Test Environment:');
  console.log(`   DATABASE_URL: ${process.env.DATABASE_URL.replace(/:[^:@]+@/, ':***@')}`);
});

afterAll(() => {
  console.log('\nStress tests completed');
});
