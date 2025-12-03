/**
 * Integration Test Setup
 *
 * This setup file is used for integration tests that require a real database.
 * Unlike unit tests, integration tests connect to an actual PostgreSQL/TimescaleDB instance.
 *
 * Requirements:
 * - Docker compose dev services running: docker compose -f docker/docker-compose.dev.yml up -d
 * - Database migrations applied: pnpm --filter @tracearr/server db:migrate
 *
 * The DATABASE_URL can be overridden via environment variable for CI.
 */

import { beforeAll, afterAll, vi } from 'vitest';

// Set test environment variables BEFORE any imports that use them
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-jwt-secret-must-be-32-chars-min';
process.env.ENCRYPTION_KEY = 'test-encryption-key-32-chars!!!';

// Use real database - default to local dev, can be overridden by CI
process.env.DATABASE_URL =
  process.env.DATABASE_URL || 'postgresql://tracearr:tracearr@localhost:5432/tracearr';
process.env.REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';

// Silence console.log in tests unless DEBUG=true
if (!process.env.DEBUG) {
  // eslint-disable-next-line @typescript-eslint/no-empty-function
  vi.spyOn(console, 'log').mockImplementation(() => {});
  // eslint-disable-next-line @typescript-eslint/no-empty-function
  vi.spyOn(console, 'info').mockImplementation(() => {});
}

beforeAll(async () => {
  process.env.TEST_INITIALIZED = 'true';

  // Verify database connection
  const { checkDatabaseConnection } = await import('../db/client.js');
  const connected = await checkDatabaseConnection();

  if (!connected) {
    throw new Error(
      'Integration tests require a running database.\n' +
        'Start dev services: docker compose -f docker/docker-compose.dev.yml up -d\n' +
        'Run migrations: pnpm --filter @tracearr/server db:migrate'
    );
  }
});

afterAll(async () => {
  delete process.env.TEST_INITIALIZED;

  // Close database connection pool
  const { closeDatabase } = await import('../db/client.js');
  await closeDatabase();
});
