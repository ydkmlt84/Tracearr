/**
 * Resolution Normalizer Tests
 *
 * Tests the shared resolution normalization utility used across all importers and pollers.
 * Specifically tests handling of widescreen/anamorphic content (Issue #75).
 */

import { describe, it, expect } from 'vitest';
import { normalizeResolution, formatQualityString } from '../resolutionNormalizer.js';

describe('normalizeResolution', () => {
  describe('resolution string priority', () => {
    it('should return 4K for "4k" string', () => {
      expect(normalizeResolution({ resolution: '4k' })).toBe('4K');
    });

    it('should return 4K for "2160" string', () => {
      expect(normalizeResolution({ resolution: '2160' })).toBe('4K');
    });

    it('should return 4K for "2160p" string', () => {
      expect(normalizeResolution({ resolution: '2160p' })).toBe('4K');
    });

    it('should return 4K for "uhd" string', () => {
      expect(normalizeResolution({ resolution: 'uhd' })).toBe('4K');
    });

    it('should return 1080p for "1080" string', () => {
      expect(normalizeResolution({ resolution: '1080' })).toBe('1080p');
    });

    it('should return 1080p for "1080p" string', () => {
      expect(normalizeResolution({ resolution: '1080p' })).toBe('1080p');
    });

    it('should return 1080p for "fhd" string', () => {
      expect(normalizeResolution({ resolution: 'fhd' })).toBe('1080p');
    });

    it('should return 720p for "720" string', () => {
      expect(normalizeResolution({ resolution: '720' })).toBe('720p');
    });

    it('should return 720p for "720p" string', () => {
      expect(normalizeResolution({ resolution: '720p' })).toBe('720p');
    });

    it('should return 720p for "hd" string', () => {
      expect(normalizeResolution({ resolution: 'hd' })).toBe('720p');
    });

    it('should return 480p for "480" string', () => {
      expect(normalizeResolution({ resolution: '480' })).toBe('480p');
    });

    it('should return SD for "sd" string', () => {
      expect(normalizeResolution({ resolution: 'sd' })).toBe('SD');
    });

    it('should be case insensitive', () => {
      expect(normalizeResolution({ resolution: '4K' })).toBe('4K');
      expect(normalizeResolution({ resolution: '1080P' })).toBe('1080p');
      expect(normalizeResolution({ resolution: 'SD' })).toBe('SD');
    });

    it('should add p suffix to numeric-only values', () => {
      expect(normalizeResolution({ resolution: '576' })).toBe('576p');
      expect(normalizeResolution({ resolution: '540' })).toBe('540p');
    });

    it('should prefer resolution string over width/height', () => {
      expect(normalizeResolution({ resolution: '1080p', width: 1280, height: 720 })).toBe('1080p');
    });
  });

  describe('width-based detection (widescreen support)', () => {
    it('should return 4K for width >= 3840', () => {
      expect(normalizeResolution({ width: 3840 })).toBe('4K');
      expect(normalizeResolution({ width: 4096 })).toBe('4K');
    });

    it('should return 1080p for width >= 1920', () => {
      expect(normalizeResolution({ width: 1920 })).toBe('1080p');
      expect(normalizeResolution({ width: 2560 })).toBe('1080p');
    });

    it('should return 720p for width >= 1280', () => {
      expect(normalizeResolution({ width: 1280 })).toBe('720p');
      expect(normalizeResolution({ width: 1600 })).toBe('720p');
    });

    it('should return 480p for width >= 854', () => {
      expect(normalizeResolution({ width: 854 })).toBe('480p');
      expect(normalizeResolution({ width: 960 })).toBe('480p');
    });

    it('should return SD for width < 854', () => {
      expect(normalizeResolution({ width: 640 })).toBe('SD');
      expect(normalizeResolution({ width: 320 })).toBe('SD');
    });

    it('should handle ultrawide 4K (3840x1600)', () => {
      expect(normalizeResolution({ width: 3840, height: 1600 })).toBe('4K');
    });
  });

  describe('widescreen/anamorphic content (Issue #75)', () => {
    it('should return 1080p for 1920x804 (2.39:1 scope)', () => {
      // This is the main bug reported in Issue #75
      expect(normalizeResolution({ width: 1920, height: 804 })).toBe('1080p');
    });

    it('should return 1080p for 1920x800 (2.40:1)', () => {
      expect(normalizeResolution({ width: 1920, height: 800 })).toBe('1080p');
    });

    it('should return 1080p for 1920x816 (2.35:1)', () => {
      expect(normalizeResolution({ width: 1920, height: 816 })).toBe('1080p');
    });

    it('should return 1080p for 1920x872 (2.20:1)', () => {
      expect(normalizeResolution({ width: 1920, height: 872 })).toBe('1080p');
    });

    it('should return 1080p for 1920x960 (2.00:1)', () => {
      expect(normalizeResolution({ width: 1920, height: 960 })).toBe('1080p');
    });

    it('should return 4K for 3840x1608 (ultrawide 4K scope)', () => {
      expect(normalizeResolution({ width: 3840, height: 1608 })).toBe('4K');
    });

    it('should return 720p for 1280x536 (2.39:1 scope at 720p)', () => {
      expect(normalizeResolution({ width: 1280, height: 536 })).toBe('720p');
    });
  });

  describe('height-based fallback', () => {
    it('should return 4K for height >= 2160 (when no width)', () => {
      expect(normalizeResolution({ height: 2160 })).toBe('4K');
      expect(normalizeResolution({ height: 2400 })).toBe('4K');
    });

    it('should return 1080p for height >= 1080 (when no width)', () => {
      expect(normalizeResolution({ height: 1080 })).toBe('1080p');
      expect(normalizeResolution({ height: 1200 })).toBe('1080p');
    });

    it('should return 720p for height >= 720 (when no width)', () => {
      expect(normalizeResolution({ height: 720 })).toBe('720p');
      expect(normalizeResolution({ height: 900 })).toBe('720p');
    });

    it('should return 480p for height >= 480 (when no width)', () => {
      expect(normalizeResolution({ height: 480 })).toBe('480p');
      expect(normalizeResolution({ height: 576 })).toBe('480p');
    });

    it('should return SD for height < 480 (when no width)', () => {
      expect(normalizeResolution({ height: 360 })).toBe('SD');
      expect(normalizeResolution({ height: 240 })).toBe('SD');
    });

    it('should return 720p for height 804 when no width (fallback behavior)', () => {
      // Without width, 804 falls between 720 and 1080, so returns 720p
      // This is the expected fallback when width is unavailable
      expect(normalizeResolution({ height: 804 })).toBe('720p');
    });
  });

  describe('null/undefined handling', () => {
    it('should return null when no resolution data provided', () => {
      expect(normalizeResolution({})).toBeNull();
    });

    it('should return null for empty input', () => {
      expect(
        normalizeResolution({ resolution: undefined, width: undefined, height: undefined })
      ).toBeNull();
    });
  });
});

describe('formatQualityString', () => {
  it('should format resolution when available', () => {
    expect(formatQualityString({ videoResolution: '1080p' })).toBe('1080p');
    expect(formatQualityString({ videoWidth: 1920, videoHeight: 1080 })).toBe('1080p');
  });

  it('should handle widescreen content correctly', () => {
    expect(formatQualityString({ videoWidth: 1920, videoHeight: 804 })).toBe('1080p');
  });

  it('should fall back to bitrate when no resolution', () => {
    expect(formatQualityString({ bitrate: 20000 })).toBe('20Mbps');
    expect(formatQualityString({ bitrate: 54000 })).toBe('54Mbps');
  });

  it('should round bitrate to Mbps', () => {
    expect(formatQualityString({ bitrate: 12500 })).toBe('13Mbps');
  });

  it('should show Transcoding when transcoding with no other data', () => {
    expect(formatQualityString({ isTranscode: true })).toBe('Transcoding');
  });

  it('should show Direct when not transcoding with no other data', () => {
    expect(formatQualityString({ isTranscode: false })).toBe('Direct');
    expect(formatQualityString({})).toBe('Direct');
  });

  it('should prefer resolution over bitrate', () => {
    expect(formatQualityString({ videoResolution: '720p', bitrate: 20000 })).toBe('720p');
  });

  it('should prefer resolution over transcode status', () => {
    expect(formatQualityString({ videoResolution: '4k', isTranscode: true })).toBe('4K');
  });

  it('should prefer bitrate over transcode status', () => {
    expect(formatQualityString({ bitrate: 15000, isTranscode: true })).toBe('15Mbps');
  });
});
