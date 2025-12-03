/**
 * Password Utility Tests
 *
 * Tests the ACTUAL exported functions from password.ts:
 * - hashPassword: Bcrypt password hashing
 * - verifyPassword: Bcrypt password verification
 *
 * These tests validate:
 * - Hash/verify roundtrip
 * - Wrong password rejection
 * - Hash format validity
 * - Different passwords produce different hashes
 */

import { describe, it, expect } from 'vitest';

// Import ACTUAL production functions - not local duplicates
import { hashPassword, verifyPassword } from '../password.js';

describe('password', () => {
  describe('hashPassword', () => {
    it('should return a bcrypt hash string', async () => {
      const hash = await hashPassword('mypassword');

      // Bcrypt hashes start with $2b$ or $2a$ and are 60 chars
      expect(hash).toMatch(/^\$2[ab]\$\d{2}\$.{53}$/);
      expect(hash).toHaveLength(60);
    });

    it('should produce different hashes for same password (random salt)', async () => {
      const password = 'samepassword';

      const hash1 = await hashPassword(password);
      const hash2 = await hashPassword(password);
      const hash3 = await hashPassword(password);

      expect(hash1).not.toBe(hash2);
      expect(hash2).not.toBe(hash3);
      expect(hash1).not.toBe(hash3);
    });

    it('should handle empty string password', async () => {
      const hash = await hashPassword('');

      expect(hash).toMatch(/^\$2[ab]\$\d{2}\$.{53}$/);

      // Should still be verifiable
      const isValid = await verifyPassword('', hash);
      expect(isValid).toBe(true);
    });

    it('should handle unicode passwords', async () => {
      const unicodePassword = '密码🔐пароль';
      const hash = await hashPassword(unicodePassword);

      expect(hash).toMatch(/^\$2[ab]\$\d{2}\$.{53}$/);

      const isValid = await verifyPassword(unicodePassword, hash);
      expect(isValid).toBe(true);
    });

    it('should handle very long passwords', async () => {
      // Note: bcrypt truncates at 72 bytes, but should still work
      const longPassword = 'x'.repeat(100);
      const hash = await hashPassword(longPassword);

      expect(hash).toMatch(/^\$2[ab]\$\d{2}\$.{53}$/);

      const isValid = await verifyPassword(longPassword, hash);
      expect(isValid).toBe(true);
    });

    it('should handle special characters', async () => {
      const specialPassword = '!@#$%^&*()_+-=[]{}|;:\'",.<>?/\\`~';
      const hash = await hashPassword(specialPassword);

      const isValid = await verifyPassword(specialPassword, hash);
      expect(isValid).toBe(true);
    });
  });

  describe('verifyPassword', () => {
    it('should return true for correct password', async () => {
      const password = 'correctpassword';
      const hash = await hashPassword(password);

      const isValid = await verifyPassword(password, hash);

      expect(isValid).toBe(true);
    });

    it('should return false for incorrect password', async () => {
      const password = 'correctpassword';
      const hash = await hashPassword(password);

      const isValid = await verifyPassword('wrongpassword', hash);

      expect(isValid).toBe(false);
    });

    it('should return false for similar but different password', async () => {
      const password = 'MyPassword123';
      const hash = await hashPassword(password);

      // Case difference
      expect(await verifyPassword('mypassword123', hash)).toBe(false);
      // Extra character
      expect(await verifyPassword('MyPassword1234', hash)).toBe(false);
      // Missing character
      expect(await verifyPassword('MyPassword12', hash)).toBe(false);
      // Whitespace
      expect(await verifyPassword(' MyPassword123', hash)).toBe(false);
      expect(await verifyPassword('MyPassword123 ', hash)).toBe(false);
    });

    it('should reject empty password against non-empty hash', async () => {
      const hash = await hashPassword('realpassword');

      const isValid = await verifyPassword('', hash);

      expect(isValid).toBe(false);
    });

    it('should handle hash from different password correctly', async () => {
      const hash1 = await hashPassword('password1');
      const hash2 = await hashPassword('password2');

      // Password 1 should not verify against hash 2
      expect(await verifyPassword('password1', hash2)).toBe(false);
      // Password 2 should not verify against hash 1
      expect(await verifyPassword('password2', hash1)).toBe(false);
    });
  });

  describe('roundtrip scenarios', () => {
    it('should work for typical user registration/login flow', async () => {
      // User registers with password
      const userPassword = 'SecureP@ssw0rd!';
      const storedHash = await hashPassword(userPassword);

      // Store hash in database (just verify format)
      expect(storedHash).not.toBe(userPassword);
      expect(storedHash).not.toContain(userPassword);

      // User logs in with correct password
      const loginAttempt1 = await verifyPassword(userPassword, storedHash);
      expect(loginAttempt1).toBe(true);

      // Attacker tries wrong password
      const loginAttempt2 = await verifyPassword('wrongpassword', storedHash);
      expect(loginAttempt2).toBe(false);
    });

    it('should work for password change flow', async () => {
      const oldPassword = 'OldPassword123';
      const newPassword = 'NewPassword456';

      // Original hash
      const oldHash = await hashPassword(oldPassword);

      // User changes password
      const newHash = await hashPassword(newPassword);

      // Old password should not work with new hash
      expect(await verifyPassword(oldPassword, newHash)).toBe(false);

      // New password should work with new hash
      expect(await verifyPassword(newPassword, newHash)).toBe(true);

      // New password should not work with old hash
      expect(await verifyPassword(newPassword, oldHash)).toBe(false);
    });

    it('should handle multiple users with same password', async () => {
      const commonPassword = 'password123';

      const user1Hash = await hashPassword(commonPassword);
      const user2Hash = await hashPassword(commonPassword);

      // Hashes should be different (different salts)
      expect(user1Hash).not.toBe(user2Hash);

      // But both should verify with the same password
      expect(await verifyPassword(commonPassword, user1Hash)).toBe(true);
      expect(await verifyPassword(commonPassword, user2Hash)).toBe(true);
    });
  });

  describe('security properties', () => {
    it('should use cost factor of at least 10', async () => {
      const hash = await hashPassword('test');

      // Extract cost factor from hash: $2b$XX$...
      const costMatch = hash.match(/^\$2[ab]\$(\d{2})\$/);
      expect(costMatch).not.toBeNull();

      const costFactor = parseInt(costMatch![1]!, 10);
      expect(costFactor).toBeGreaterThanOrEqual(10);
    });

    it('should not expose password in hash', async () => {
      const password = 'secretpassword';
      const hash = await hashPassword(password);

      // Hash should not contain the password
      expect(hash.toLowerCase()).not.toContain(password.toLowerCase());
    });
  });
});
