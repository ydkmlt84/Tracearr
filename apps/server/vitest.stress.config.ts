/**
 * Vitest Configuration for Stress Tests
 *
 * Stress tests run against a REAL database to measure actual query performance,
 * memory usage, and index effectiveness.
 *
 * Run with: pnpm test:stress
 *
 * Requirements:
 * - Real PostgreSQL database running with connection via DATABASE_URL
 * - Redis running (for distributed lock testing)
 *
 * These tests will create ~5000 historical sessions, so use with caution
 * on production databases!
 */

import { defineConfig } from 'vitest/config';
import { resolve } from 'node:path';
import { config as dotenvConfig } from 'dotenv';

// Load environment variables from monorepo root .env file
dotenvConfig({ path: resolve(__dirname, '../../.env') });

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    // Use a minimal setup that doesn't override DATABASE_URL
    setupFiles: ['./src/test/stress/setup.ts'],
    include: ['src/test/stress/**/*.test.ts'],
    testTimeout: 300000, // 5 minutes - stress tests take time
    hookTimeout: 120000, // 2 minutes for setup/teardown
  },
  resolve: {
    alias: {
      '@tracearr/shared': resolve(__dirname, '../../packages/shared/src'),
      '@tracearr/test-utils': resolve(__dirname, '../../packages/test-utils/dist'),
    },
  },
});
