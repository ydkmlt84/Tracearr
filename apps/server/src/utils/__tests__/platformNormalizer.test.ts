/**
 * Platform Normalizer Tests
 *
 * Tests the shared platform normalization utility used across all importers and pollers.
 */

import { describe, it, expect } from 'vitest';
import { normalizeClient, normalizePlatformName } from '../platformNormalizer.js';

describe('normalizeClient', () => {
  describe('iOS devices', () => {
    it('should parse "Jellyfin iOS" as iOS/iPhone', () => {
      const result = normalizeClient('Jellyfin iOS');
      expect(result.platform).toBe('iOS');
      expect(result.device).toBe('iPhone');
    });

    it('should parse clients containing "iphone" as iOS/iPhone', () => {
      const result = normalizeClient('Jellyfin for iPhone');
      expect(result.platform).toBe('iOS');
      expect(result.device).toBe('iPhone');
    });

    it('should parse "Jellyfin iPad" as iOS/iPad', () => {
      const result = normalizeClient('Jellyfin iPad');
      expect(result.platform).toBe('iOS');
      expect(result.device).toBe('iPad');
    });

    it('should be case insensitive for iOS detection', () => {
      expect(normalizeClient('jellyfin IOS').platform).toBe('iOS');
      expect(normalizeClient('JELLYFIN iOS').platform).toBe('iOS');
    });

    it('should use deviceType when provided', () => {
      const result = normalizeClient('Jellyfin iOS', 'iPhone 15 Pro');
      expect(result.platform).toBe('iOS');
      expect(result.device).toBe('iPhone 15 Pro');
    });
  });

  describe('Android devices', () => {
    it('should parse "Jellyfin Android" as Android/Android', () => {
      const result = normalizeClient('Jellyfin Android');
      expect(result.platform).toBe('Android');
      expect(result.device).toBe('Android');
    });

    it('should parse Android TV clients as Android TV', () => {
      const result = normalizeClient('Jellyfin Android TV');
      expect(result.platform).toBe('Android TV');
      expect(result.device).toBe('Android TV');
    });

    it('should parse "AndroidTv" (no space) as Android TV', () => {
      const result = normalizeClient('AndroidTv');
      expect(result.platform).toBe('Android TV');
      expect(result.device).toBe('Android TV');
    });

    it('should parse Shield clients as Android TV', () => {
      const result = normalizeClient('Jellyfin for Shield');
      expect(result.platform).toBe('Android TV');
      expect(result.device).toBe('Android TV');
    });

    it('should parse NVIDIA Shield with Android in name', () => {
      const result = normalizeClient('Jellyfin Android Shield');
      expect(result.platform).toBe('Android TV');
      expect(result.device).toBe('Android TV');
    });

    it('should parse just "Shield" as Android TV', () => {
      const result = normalizeClient('Shield');
      expect(result.platform).toBe('Android TV');
      expect(result.device).toBe('Android TV');
    });
  });

  describe('Smart TVs', () => {
    it('should parse Samsung/Tizen clients as Samsung TV', () => {
      expect(normalizeClient('Jellyfin Samsung')).toEqual({
        platform: 'Tizen',
        device: 'Samsung TV',
      });
      expect(normalizeClient('Jellyfin Tizen')).toEqual({
        platform: 'Tizen',
        device: 'Samsung TV',
      });
    });

    it('should parse LG/webOS clients as LG TV', () => {
      expect(normalizeClient('Jellyfin webOS')).toEqual({
        platform: 'webOS',
        device: 'LG TV',
      });
      expect(normalizeClient('Jellyfin LG')).toEqual({
        platform: 'webOS',
        device: 'LG TV',
      });
    });

    it('should parse Roku clients as Roku', () => {
      expect(normalizeClient('Jellyfin Roku')).toEqual({
        platform: 'Roku',
        device: 'Roku',
      });
    });

    it('should parse Fire TV clients', () => {
      expect(normalizeClient('Jellyfin Fire TV')).toEqual({
        platform: 'Fire TV',
        device: 'Fire TV',
      });
    });
  });

  describe('Apple TV', () => {
    it('should parse tvOS clients as Apple TV', () => {
      expect(normalizeClient('Jellyfin tvOS')).toEqual({
        platform: 'tvOS',
        device: 'Apple TV',
      });
    });

    it('should parse "Apple TV" in client name as Apple TV', () => {
      expect(normalizeClient('Jellyfin Apple TV')).toEqual({
        platform: 'tvOS',
        device: 'Apple TV',
      });
    });

    it('should parse Swiftfin as Apple TV', () => {
      expect(normalizeClient('Swiftfin')).toEqual({
        platform: 'tvOS',
        device: 'Apple TV',
      });
    });
  });

  describe('Gaming Consoles', () => {
    it('should parse Xbox clients', () => {
      expect(normalizeClient('Jellyfin Xbox')).toEqual({
        platform: 'Xbox',
        device: 'Xbox',
      });
    });

    it('should parse PlayStation clients', () => {
      expect(normalizeClient('Jellyfin PlayStation')).toEqual({
        platform: 'PlayStation',
        device: 'PlayStation',
      });
      expect(normalizeClient('Jellyfin PS5')).toEqual({
        platform: 'PlayStation',
        device: 'PlayStation',
      });
    });
  });

  describe('Web browsers', () => {
    it('should parse "Jellyfin Web" as Web/Browser', () => {
      expect(normalizeClient('Jellyfin Web')).toEqual({
        platform: 'Web',
        device: 'Browser',
      });
    });

    it('should parse browser names', () => {
      expect(normalizeClient('Chrome').platform).toBe('Chrome');
      expect(normalizeClient('Safari').platform).toBe('Safari');
      expect(normalizeClient('Firefox').platform).toBe('Firefox');
      expect(normalizeClient('Edge').platform).toBe('Edge');
    });
  });

  describe('Desktop apps', () => {
    it('should parse Windows clients', () => {
      expect(normalizeClient('Jellyfin Windows').platform).toBe('Windows');
    });

    it('should parse macOS clients', () => {
      expect(normalizeClient('Jellyfin macOS').platform).toBe('macOS');
    });

    it('should parse Linux clients', () => {
      expect(normalizeClient('Jellyfin Linux').platform).toBe('Linux');
    });
  });

  describe('Media players', () => {
    it('should parse Kodi clients as Kodi', () => {
      expect(normalizeClient('Kodi')).toEqual({
        platform: 'Kodi',
        device: 'Kodi',
      });
      expect(normalizeClient('Jellyfin for Kodi')).toEqual({
        platform: 'Kodi',
        device: 'Kodi',
      });
    });

    it('should parse "Emby for Kodi Next Gen" as Kodi', () => {
      expect(normalizeClient('Emby for Kodi Next Gen')).toEqual({
        platform: 'Kodi',
        device: 'Kodi',
      });
    });

    it('should parse Infuse clients as Infuse', () => {
      expect(normalizeClient('Infuse')).toEqual({
        platform: 'Infuse',
        device: 'Infuse',
      });
      expect(normalizeClient('Infuse 7')).toEqual({
        platform: 'Infuse',
        device: 'Infuse',
      });
    });

    it('should parse VLC clients', () => {
      expect(normalizeClient('VLC').platform).toBe('VLC');
    });
  });

  describe('Third-party Jellyfin clients', () => {
    it('should parse Findroid as Android', () => {
      expect(normalizeClient('Findroid').platform).toBe('Android');
    });

    it('should parse Finamp', () => {
      expect(normalizeClient('Finamp').platform).toBe('Finamp');
    });

    it('should parse Streamyfin', () => {
      expect(normalizeClient('Streamyfin').platform).toBe('Streamyfin');
    });

    it('should parse JellyBox', () => {
      expect(normalizeClient('JellyBox').platform).toBe('JellyBox');
    });

    it('should parse Gelli', () => {
      expect(normalizeClient('Gelli').platform).toBe('Gelli');
    });
  });

  describe('Plex clients', () => {
    it('should parse Plexamp', () => {
      expect(normalizeClient('Plexamp').platform).toBe('Plexamp');
    });

    it('should parse Plex HTPC', () => {
      expect(normalizeClient('Plex HTPC').platform).toBe('Plex HTPC');
    });

    it('should parse Plex Media Player', () => {
      expect(normalizeClient('Plex Media Player').platform).toBe('Plex Media Player');
    });

    it('should parse SyncLounge', () => {
      expect(normalizeClient('SyncLounge')).toEqual({
        platform: 'SyncLounge',
        device: 'SyncLounge',
      });
    });

    it('should parse PlexTogether as SyncLounge', () => {
      expect(normalizeClient('PlexTogether')).toEqual({
        platform: 'SyncLounge',
        device: 'SyncLounge',
      });
    });
  });

  describe('Legacy Plex clients (Tautulli compatibility)', () => {
    it('should parse Konvergo as Plex Media Player', () => {
      expect(normalizeClient('Konvergo')).toEqual({
        platform: 'Plex Media Player',
        device: 'Plex Media Player',
      });
    });

    it('should parse Mystery 3 as PlayStation 3', () => {
      expect(normalizeClient('Mystery 3')).toEqual({
        platform: 'PlayStation',
        device: 'PlayStation 3',
      });
    });

    it('should parse Mystery 4 as PlayStation 4', () => {
      expect(normalizeClient('Mystery 4')).toEqual({
        platform: 'PlayStation',
        device: 'PlayStation 4',
      });
    });

    it('should parse WebMAF as PlayStation 4', () => {
      expect(normalizeClient('WebMAF')).toEqual({
        platform: 'PlayStation',
        device: 'PlayStation 4',
      });
    });

    it('should parse Mystery 5 as Xbox 360', () => {
      expect(normalizeClient('Mystery 5')).toEqual({
        platform: 'Xbox',
        device: 'Xbox 360',
      });
    });

    it('should parse osx as macOS', () => {
      expect(normalizeClient('osx')).toEqual({
        platform: 'macOS',
        device: 'Mac',
      });
    });
  });

  describe('Chromecast', () => {
    it('should parse Chromecast as separate platform', () => {
      expect(normalizeClient('Chromecast')).toEqual({
        platform: 'Chromecast',
        device: 'Chromecast',
      });
    });

    it('should parse Plex for Chromecast', () => {
      expect(normalizeClient('Plex for Chromecast').platform).toBe('Chromecast');
    });
  });

  describe('DLNA devices', () => {
    it('should parse DLNA clients', () => {
      expect(normalizeClient('DLNA')).toEqual({
        platform: 'DLNA',
        device: 'DLNA Device',
      });
    });

    it('should detect DLNA from deviceType when client is empty', () => {
      expect(normalizeClient('', 'DLNA')).toEqual({
        platform: 'DLNA',
        device: 'DLNA',
      });
    });
  });

  describe('Additional gaming consoles', () => {
    it('should parse Wii U clients', () => {
      expect(normalizeClient('Wii U')).toEqual({
        platform: 'Wii U',
        device: 'Wii U',
      });
      expect(normalizeClient('WiiU')).toEqual({
        platform: 'Wii U',
        device: 'Wii U',
      });
    });
  });

  describe('Additional Smart TVs', () => {
    it('should parse LG Netcast as webOS/LG TV', () => {
      expect(normalizeClient('Netcast')).toEqual({
        platform: 'webOS',
        device: 'LG TV',
      });
    });
  });

  describe('Additional browsers', () => {
    it('should parse Opera browser', () => {
      expect(normalizeClient('Opera').platform).toBe('Opera');
      expect(normalizeClient('Opera').device).toBe('Browser');
    });
  });

  describe('Android variants', () => {
    it('should parse Nexus as Android', () => {
      expect(normalizeClient('Nexus').platform).toBe('Android');
    });

    it('should parse Nexus Player as Android', () => {
      expect(normalizeClient('Nexus Player').platform).toBe('Android');
    });
  });

  describe('deviceType parameter', () => {
    it('should use deviceType when provided and meaningful', () => {
      const result = normalizeClient('Custom Client', 'Smart TV');
      expect(result.platform).toBe('Custom Client');
      expect(result.device).toBe('Smart TV');
    });

    it('should ignore deviceType when empty', () => {
      const result = normalizeClient('Jellyfin iOS', '');
      expect(result.platform).toBe('iOS');
      expect(result.device).toBe('iPhone');
    });

    it('should ignore deviceType when "Unknown"', () => {
      const result = normalizeClient('Jellyfin Android', 'Unknown');
      expect(result.platform).toBe('Android');
      expect(result.device).toBe('Android');
    });

    it('should use deviceType as device when client is recognized', () => {
      const result = normalizeClient('Jellyfin iOS', 'Custom Device');
      expect(result.platform).toBe('iOS');
      expect(result.device).toBe('Custom Device');
    });
  });

  describe('fallback behavior', () => {
    it('should use client name as fallback for unknown clients', () => {
      const result = normalizeClient('Unknown Client App');
      expect(result.platform).toBe('Unknown Client App');
      expect(result.device).toBe('Unknown Client App');
    });

    it('should handle empty client string', () => {
      const result = normalizeClient('');
      expect(result.platform).toBe('Unknown');
      expect(result.device).toBe('Unknown');
    });
  });
});

describe('normalizePlatformName', () => {
  it('should normalize casing for iOS', () => {
    expect(normalizePlatformName('ios')).toBe('iOS');
    expect(normalizePlatformName('IOS')).toBe('iOS');
    expect(normalizePlatformName('iOS')).toBe('iOS');
  });

  it('should normalize Android TV variations', () => {
    expect(normalizePlatformName('android tv')).toBe('Android TV');
    expect(normalizePlatformName('androidtv')).toBe('Android TV');
    expect(normalizePlatformName('Android TV')).toBe('Android TV');
  });

  it('should normalize Plex Web', () => {
    expect(normalizePlatformName('Plex Web')).toBe('Web');
    expect(normalizePlatformName('plex web')).toBe('Web');
  });

  it('should normalize Plex for iOS', () => {
    expect(normalizePlatformName('Plex for iOS')).toBe('iOS');
    expect(normalizePlatformName('plex for ios')).toBe('iOS');
  });

  it('should normalize legacy macOS names', () => {
    expect(normalizePlatformName('osx')).toBe('macOS');
    expect(normalizePlatformName('mac os')).toBe('macOS');
    expect(normalizePlatformName('macos')).toBe('macOS');
  });

  it('should normalize Smart TV platforms', () => {
    expect(normalizePlatformName('tizen')).toBe('Tizen');
    expect(normalizePlatformName('samsung')).toBe('Tizen');
    expect(normalizePlatformName('webos')).toBe('webOS');
    expect(normalizePlatformName('netcast')).toBe('webOS');
    expect(normalizePlatformName('chromecast')).toBe('Chromecast');
    expect(normalizePlatformName('dlna')).toBe('DLNA');
  });

  it('should normalize gaming consoles', () => {
    expect(normalizePlatformName('xbox')).toBe('Xbox');
    expect(normalizePlatformName('playstation')).toBe('PlayStation');
    expect(normalizePlatformName('wiiu')).toBe('Wii U');
    expect(normalizePlatformName('wii u')).toBe('Wii U');
  });

  it('should normalize Plex client names', () => {
    expect(normalizePlatformName('konvergo')).toBe('Plex Media Player');
    expect(normalizePlatformName('plexamp')).toBe('Plexamp');
    expect(normalizePlatformName('synclounge')).toBe('SyncLounge');
    expect(normalizePlatformName('plextogether')).toBe('SyncLounge');
  });

  it('should normalize Jellyfin client names', () => {
    expect(normalizePlatformName('swiftfin')).toBe('tvOS');
    expect(normalizePlatformName('findroid')).toBe('Android');
    expect(normalizePlatformName('finamp')).toBe('Finamp');
  });

  it('should normalize browsers', () => {
    expect(normalizePlatformName('chrome')).toBe('Chrome');
    expect(normalizePlatformName('safari')).toBe('Safari');
    expect(normalizePlatformName('firefox')).toBe('Firefox');
    expect(normalizePlatformName('opera')).toBe('Opera');
  });

  it('should preserve unknown platform names with proper casing', () => {
    expect(normalizePlatformName('customPlatform')).toBe('CustomPlatform');
    expect(normalizePlatformName('mydevice')).toBe('Mydevice');
  });

  it('should handle empty string', () => {
    expect(normalizePlatformName('')).toBe('Unknown');
  });
});
