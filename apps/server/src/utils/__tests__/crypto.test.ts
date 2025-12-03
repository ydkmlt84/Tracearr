/**
 * Crypto Utility Tests
 *
 * Tests the ACTUAL exported functions from crypto.ts:
 * - initializeEncryption: Initialize with env key
 * - isEncryptionInitialized: Check initialization state
 * - encrypt/decrypt: AES-256-GCM roundtrip
 * - generateEncryptionKey: Random key generation
 *
 * These tests validate:
 * - Proper key validation (length, format)
 * - Encryption/decryption roundtrip integrity
 * - Tampering detection (GCM auth tag)
 * - Error handling for uninitialized state
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// Import only what's used directly (other functions are dynamically imported per-test after vi.resetModules())
import { generateEncryptionKey } from '../crypto.js';

// Valid 32-byte key as 64 hex characters
const VALID_KEY = 'a'.repeat(64);
const ANOTHER_VALID_KEY = 'b'.repeat(64);

describe('crypto', () => {
  // Store original env and reset module state between tests
  const originalEnv = process.env.ENCRYPTION_KEY;

  beforeEach(() => {
    // Clear the module's internal state by re-importing
    // Since we can't easily reset module state, we'll work around it
    vi.resetModules();
  });

  afterEach(() => {
    // Restore original env
    if (originalEnv !== undefined) {
      process.env.ENCRYPTION_KEY = originalEnv;
    } else {
      delete process.env.ENCRYPTION_KEY;
    }
  });

  describe('generateEncryptionKey', () => {
    it('should generate a 64-character hex string', () => {
      const key = generateEncryptionKey();

      expect(key).toHaveLength(64);
      expect(key).toMatch(/^[0-9a-f]{64}$/);
    });

    it('should generate unique keys on each call', () => {
      const key1 = generateEncryptionKey();
      const key2 = generateEncryptionKey();
      const key3 = generateEncryptionKey();

      expect(key1).not.toBe(key2);
      expect(key2).not.toBe(key3);
      expect(key1).not.toBe(key3);
    });

    it('should generate keys that are valid for initializeEncryption', async () => {
      const key = generateEncryptionKey();
      process.env.ENCRYPTION_KEY = key;

      // Re-import to get fresh module state
      const { initializeEncryption: init } = await import('../crypto.js');

      expect(() => init()).not.toThrow();
    });
  });

  describe('initializeEncryption', () => {
    it('should initialize successfully with valid 64-char hex key', async () => {
      process.env.ENCRYPTION_KEY = VALID_KEY;

      const { initializeEncryption: init, isEncryptionInitialized: isInit } =
        await import('../crypto.js');

      expect(() => init()).not.toThrow();
      expect(isInit()).toBe(true);
    });

    it('should throw when ENCRYPTION_KEY is missing', async () => {
      delete process.env.ENCRYPTION_KEY;

      const { initializeEncryption: init } = await import('../crypto.js');

      expect(() => init()).toThrow('ENCRYPTION_KEY environment variable is required');
    });

    it('should throw when ENCRYPTION_KEY is empty string', async () => {
      process.env.ENCRYPTION_KEY = '';

      const { initializeEncryption: init } = await import('../crypto.js');

      expect(() => init()).toThrow('ENCRYPTION_KEY environment variable is required');
    });

    it('should throw when key is too short', async () => {
      process.env.ENCRYPTION_KEY = 'a'.repeat(32); // 16 bytes, need 32

      const { initializeEncryption: init } = await import('../crypto.js');

      expect(() => init()).toThrow('ENCRYPTION_KEY must be 64 hex characters (32 bytes)');
    });

    it('should throw when key is too long', async () => {
      process.env.ENCRYPTION_KEY = 'a'.repeat(128); // 64 bytes, need 32

      const { initializeEncryption: init } = await import('../crypto.js');

      expect(() => init()).toThrow('ENCRYPTION_KEY must be 64 hex characters (32 bytes)');
    });
  });

  describe('isEncryptionInitialized', () => {
    it('should return false before initialization', async () => {
      delete process.env.ENCRYPTION_KEY;

      const { isEncryptionInitialized: isInit } = await import('../crypto.js');

      expect(isInit()).toBe(false);
    });

    it('should return true after successful initialization', async () => {
      process.env.ENCRYPTION_KEY = VALID_KEY;

      const { initializeEncryption: init, isEncryptionInitialized: isInit } =
        await import('../crypto.js');

      init();
      expect(isInit()).toBe(true);
    });
  });

  describe('encrypt', () => {
    it('should throw when encryption is not initialized', async () => {
      delete process.env.ENCRYPTION_KEY;

      const { encrypt: enc } = await import('../crypto.js');

      expect(() => enc('test')).toThrow('Encryption not initialized');
    });

    it('should return a base64 string', async () => {
      process.env.ENCRYPTION_KEY = VALID_KEY;

      const { initializeEncryption: init, encrypt: enc } = await import('../crypto.js');
      init();

      const encrypted = enc('hello world');

      // Should be valid base64
      expect(() => Buffer.from(encrypted, 'base64')).not.toThrow();
      expect(encrypted).toMatch(/^[A-Za-z0-9+/]+=*$/);
    });

    it('should produce different ciphertext for same plaintext (random IV)', async () => {
      process.env.ENCRYPTION_KEY = VALID_KEY;

      const { initializeEncryption: init, encrypt: enc } = await import('../crypto.js');
      init();

      const plaintext = 'same input';
      const encrypted1 = enc(plaintext);
      const encrypted2 = enc(plaintext);
      const encrypted3 = enc(plaintext);

      expect(encrypted1).not.toBe(encrypted2);
      expect(encrypted2).not.toBe(encrypted3);
      expect(encrypted1).not.toBe(encrypted3);
    });

    it('should handle empty string', async () => {
      process.env.ENCRYPTION_KEY = VALID_KEY;

      const { initializeEncryption: init, encrypt: enc, decrypt: dec } =
        await import('../crypto.js');
      init();

      const encrypted = enc('');
      expect(typeof encrypted).toBe('string');
      expect(encrypted.length).toBeGreaterThan(0);

      // Should decrypt back to empty string
      expect(dec(encrypted)).toBe('');
    });

    it('should handle unicode characters', async () => {
      process.env.ENCRYPTION_KEY = VALID_KEY;

      const { initializeEncryption: init, encrypt: enc, decrypt: dec } =
        await import('../crypto.js');
      init();

      const unicodeText = '你好世界 🌍 Привет мир';
      const encrypted = enc(unicodeText);
      expect(dec(encrypted)).toBe(unicodeText);
    });

    it('should handle long strings', async () => {
      process.env.ENCRYPTION_KEY = VALID_KEY;

      const { initializeEncryption: init, encrypt: enc, decrypt: dec } =
        await import('../crypto.js');
      init();

      const longText = 'x'.repeat(100000); // 100KB of text
      const encrypted = enc(longText);
      expect(dec(encrypted)).toBe(longText);
    });
  });

  describe('decrypt', () => {
    it('should throw when encryption is not initialized', async () => {
      delete process.env.ENCRYPTION_KEY;

      const { decrypt: dec } = await import('../crypto.js');

      expect(() => dec('somebase64data')).toThrow('Encryption not initialized');
    });

    it('should decrypt what was encrypted (roundtrip)', async () => {
      process.env.ENCRYPTION_KEY = VALID_KEY;

      const { initializeEncryption: init, encrypt: enc, decrypt: dec } =
        await import('../crypto.js');
      init();

      const testCases = [
        'simple text',
        'with numbers 12345',
        'special chars !@#$%^&*()',
        'multi\nline\ntext',
        JSON.stringify({ key: 'value', nested: { array: [1, 2, 3] } }),
      ];

      for (const plaintext of testCases) {
        const encrypted = enc(plaintext);
        const decrypted = dec(encrypted);
        expect(decrypted).toBe(plaintext);
      }
    });

    it('should fail on tampered ciphertext (GCM auth)', async () => {
      process.env.ENCRYPTION_KEY = VALID_KEY;

      const { initializeEncryption: init, encrypt: enc, decrypt: dec } =
        await import('../crypto.js');
      init();

      const encrypted = enc('sensitive data');

      // Tamper with the ciphertext
      const buffer = Buffer.from(encrypted, 'base64');
      const lastIndex = buffer.length - 1;
      buffer[lastIndex] = (buffer[lastIndex] ?? 0) ^ 0xff; // Flip bits in last byte
      const tampered = buffer.toString('base64');

      expect(() => dec(tampered)).toThrow();
    });

    it('should fail on truncated ciphertext', async () => {
      process.env.ENCRYPTION_KEY = VALID_KEY;

      const { initializeEncryption: init, encrypt: enc, decrypt: dec } =
        await import('../crypto.js');
      init();

      const encrypted = enc('test data');

      // Truncate the ciphertext
      const truncated = encrypted.substring(0, encrypted.length - 10);

      expect(() => dec(truncated)).toThrow();
    });

    it('should fail with wrong key', async () => {
      // Encrypt with first key
      process.env.ENCRYPTION_KEY = VALID_KEY;
      const { initializeEncryption: init1, encrypt: enc } = await import('../crypto.js');
      init1();
      const encrypted = enc('secret');

      // Reset module and try to decrypt with different key
      vi.resetModules();
      process.env.ENCRYPTION_KEY = ANOTHER_VALID_KEY;
      const { initializeEncryption: init2, decrypt: dec } = await import('../crypto.js');
      init2();

      expect(() => dec(encrypted)).toThrow();
    });

    it('should fail on invalid base64 input', async () => {
      process.env.ENCRYPTION_KEY = VALID_KEY;

      const { initializeEncryption: init, decrypt: dec } = await import('../crypto.js');
      init();

      expect(() => dec('not-valid-base64!!!')).toThrow();
    });
  });

  describe('real-world scenarios', () => {
    it('should handle API token encryption workflow', async () => {
      process.env.ENCRYPTION_KEY = VALID_KEY;

      const { initializeEncryption: init, encrypt: enc, decrypt: dec } =
        await import('../crypto.js');
      init();

      // Simulate storing a Plex/Jellyfin API token
      const apiToken = 'plextoken_abcdef123456789';
      const encryptedToken = enc(apiToken);

      // Store in database (just verify it's not plaintext)
      expect(encryptedToken).not.toContain(apiToken);
      expect(encryptedToken).not.toContain('plex');

      // Later, retrieve and decrypt
      const retrievedToken = dec(encryptedToken);
      expect(retrievedToken).toBe(apiToken);
    });

    it('should handle JWT secret encryption', async () => {
      process.env.ENCRYPTION_KEY = VALID_KEY;

      const { initializeEncryption: init, encrypt: enc, decrypt: dec } =
        await import('../crypto.js');
      init();

      const jwtSecret = 'super-secret-jwt-signing-key-that-should-never-leak';
      const encrypted = enc(jwtSecret);

      // Verify no part of the secret is visible
      expect(encrypted).not.toContain('secret');
      expect(encrypted).not.toContain('jwt');

      expect(dec(encrypted)).toBe(jwtSecret);
    });
  });
});
