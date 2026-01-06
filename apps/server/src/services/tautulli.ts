/**
 * Tautulli API integration and import service
 */

import { eq } from 'drizzle-orm';
import { z } from 'zod';
import type { TautulliImportProgress, TautulliImportResult } from '@tracearr/shared';
import { db } from '../db/client.js';
import { settings, sessions, serverUsers, users } from '../db/schema.js';
import { refreshAggregates } from '../db/timescale.js';
import { geoipService } from './geoip.js';
import type { PubSubService } from './cache.js';
import {
  queryExistingByExternalIds,
  queryExistingByTimeKeys,
  createTimeKey,
  createUserMapping,
  createSkippedUserTracker,
  flushInsertBatch,
  flushUpdateBatch,
  type SessionUpdate,
  createSimpleProgressPublisher,
} from './import/index.js';
import { normalizePlatformName } from '../utils/platformNormalizer.js';
import { normalizeStreamDecisions } from '../utils/transcodeNormalizer.js';

const PAGE_SIZE = 5000; // Larger batches = fewer API calls (tested up to 10k, scales linearly)
const REQUEST_TIMEOUT_MS = 30000; // 30 seconds
const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 1000; // Base delay, will be multiplied by attempt number

// Helper for fields that can be number or empty string (Tautulli API inconsistency)
// Exported for testing
export const numberOrEmptyString = z.union([z.number(), z.literal('')]);
// Helper for fields that can be number, empty string, or null (movies have null parent/grandparent keys)
export const numberOrEmptyStringOrNull = z.union([z.number(), z.literal(''), z.null()]);

// Zod schemas for runtime validation of Tautulli API responses
// Exported for testing
export const TautulliHistoryRecordSchema = z.object({
  // IDs - can be null for active sessions
  reference_id: z.number().nullable(),
  row_id: z.number().nullable(),
  id: z.number().nullable(), // Additional ID field

  // Timestamps and durations - always numbers
  date: z.number(),
  started: z.number(),
  stopped: z.number(),
  duration: z.number(),
  play_duration: z.number(), // Actual play time
  paused_counter: z.number(),

  // User info (coerce handles string/number inconsistency across Tautulli versions)
  user_id: z.coerce.number(),
  user: z.string().nullable(), // Only used in warning message
  friendly_name: z.string().nullable(),
  user_thumb: z.string().nullable(), // User avatar URL

  // Player/client info
  platform: z.string().nullable(),
  product: z.string().nullable(),
  player: z.string().nullable(),
  ip_address: z.string().nullable(),
  machine_id: z.string().nullable(),
  location: z.string().nullable(),

  // Boolean-like flags (0/1) - can be null in some Tautulli versions
  live: z.number().nullable(),
  secure: z.number().nullable(),
  relayed: z.number().nullable(),

  // Media info
  media_type: z.string(),
  rating_key: z.coerce.number(), // Coerce handles string/number inconsistency
  // These CAN be empty string, number, or null depending on media type
  parent_rating_key: numberOrEmptyStringOrNull,
  grandparent_rating_key: numberOrEmptyStringOrNull,
  full_title: z.string(),
  title: z.string(),
  parent_title: z.string().nullable(),
  grandparent_title: z.string().nullable(),
  original_title: z.string().nullable(),
  // year: number for movies, empty string "" for episodes, or null
  year: numberOrEmptyStringOrNull,
  // media_index: number for episodes, empty string for movies, or null
  media_index: numberOrEmptyStringOrNull,
  parent_media_index: numberOrEmptyStringOrNull,
  thumb: z.string().nullable(),
  originally_available_at: z.string().nullable(),
  guid: z.string().nullable(),

  // Playback info
  transcode_decision: z.string().nullable(),
  percent_complete: z.coerce.number(),
  watched_status: z.coerce.number(), // 0, 0.75, 1

  // Session grouping
  group_count: z.number().nullable(),
  group_ids: z.string().nullable(),
  state: z.string().nullable(),
  session_key: z.union([z.null(), z.coerce.number()]), // Null first, then coerce string/number
});

export const TautulliHistoryResponseSchema = z.object({
  response: z.object({
    result: z.string(),
    message: z.string().nullable(),
    data: z.object({
      recordsFiltered: z.number(),
      recordsTotal: z.number(),
      data: z.array(TautulliHistoryRecordSchema),
      draw: z.number(),
      filter_duration: z.string(),
      total_duration: z.string(),
    }),
  }),
});

export const TautulliUserRecordSchema = z.object({
  user_id: z.coerce.number(),
  username: z.string(),
  friendly_name: z.string().nullable(),
  email: z.string().nullable(), // Can be null for local users
  thumb: z.string().nullable(), // Can be null for local users
  is_home_user: z.number().nullable(), // Can be null for local users
  is_admin: z.number(),
  is_active: z.number(),
  do_notify: z.number(),
});

export const TautulliUsersResponseSchema = z.object({
  response: z.object({
    result: z.string(),
    message: z.string().nullable(),
    data: z.array(TautulliUserRecordSchema),
  }),
});

// Infer types from schemas - exported for testing
export type TautulliHistoryRecord = z.infer<typeof TautulliHistoryRecordSchema>;
export type TautulliHistoryResponse = z.infer<typeof TautulliHistoryResponseSchema>;
export type TautulliUserRecord = z.infer<typeof TautulliUserRecordSchema>;
export type TautulliUsersResponse = z.infer<typeof TautulliUsersResponseSchema>;

export class TautulliService {
  private baseUrl: string;
  private apiKey: string;

  constructor(url: string, apiKey: string) {
    // Validate URL format
    try {
      new URL(url);
    } catch {
      throw new Error('Invalid Tautulli URL format');
    }
    if (!apiKey || apiKey.length < 1) {
      throw new Error('Tautulli API key is required');
    }
    this.baseUrl = url.replace(/\/$/, '');
    this.apiKey = apiKey;
  }

  /**
   * Sync friendly/custom user names from Tautulli to Tracearr identities
   */
  private static async syncFriendlyNamesFromTautulli(
    serverId: string,
    tautulli: TautulliService,
    overwriteAll: boolean
  ): Promise<number> {
    const tautulliUsers = await tautulli.getUsers();

    // Build map of externalId -> friendly name (trimmed, non-empty)
    const friendlyByExternalId = new Map<string, string>();
    for (const user of tautulliUsers) {
      const friendlyName = user.friendly_name?.trim();
      if (friendlyName) {
        friendlyByExternalId.set(String(user.user_id), friendlyName);
      }
    }

    if (friendlyByExternalId.size === 0) {
      return 0;
    }

    // Fetch server users for this server with linked identity info
    const serverUserRows = await db
      .select({
        serverUserId: serverUsers.id,
        externalId: serverUsers.externalId,
        userId: serverUsers.userId,
        identityName: users.name,
      })
      .from(serverUsers)
      .innerJoin(users, eq(serverUsers.userId, users.id))
      .where(eq(serverUsers.serverId, serverId));

    const updates = new Map<string, string>();

    for (const row of serverUserRows) {
      const friendlyName = friendlyByExternalId.get(row.externalId);
      if (!friendlyName) continue;

      const currentName = row.identityName?.trim();
      const hasExistingName = !!currentName && currentName.length > 0;
      if (hasExistingName && !overwriteAll) continue;

      if (currentName === friendlyName) continue;

      updates.set(row.userId, friendlyName);
    }

    if (updates.size === 0) {
      return 0;
    }

    await db.transaction(async (tx) => {
      for (const [userId, friendlyName] of updates) {
        await tx
          .update(users)
          .set({
            name: friendlyName,
            updatedAt: new Date(),
          })
          .where(eq(users.id, userId));
      }
    });

    return updates.size;
  }

  /**
   * Make API request to Tautulli with timeout and retry logic
   */
  private async request<T>(
    cmd: string,
    params: Record<string, string | number> = {},
    schema?: z.ZodType<T>
  ): Promise<T> {
    const url = new URL(`${this.baseUrl}/api/v2`);
    url.searchParams.set('apikey', this.apiKey);
    url.searchParams.set('cmd', cmd);

    for (const [key, value] of Object.entries(params)) {
      url.searchParams.set(key, String(value));
    }

    let lastError: Error | null = null;

    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

      try {
        const response = await fetch(url.toString(), {
          signal: controller.signal,
        });

        clearTimeout(timeoutId);

        if (!response.ok) {
          throw new Error(`Tautulli API error: ${response.status} ${response.statusText}`);
        }

        const json = await response.json();

        // Validate response with Zod schema if provided
        if (schema) {
          const parsed = schema.safeParse(json);
          if (!parsed.success) {
            console.error('Tautulli API response validation failed:', z.treeifyError(parsed.error));
            throw new Error(`Invalid Tautulli API response: ${parsed.error.message}`);
          }
          return parsed.data;
        }

        return json as T;
      } catch (error) {
        clearTimeout(timeoutId);

        if (error instanceof Error) {
          // Don't retry on abort (timeout) after max retries
          if (error.name === 'AbortError') {
            lastError = new Error(`Tautulli API timeout after ${REQUEST_TIMEOUT_MS}ms`);
          } else {
            lastError = error;
          }
        } else {
          lastError = new Error('Unknown error');
        }

        // Don't retry on validation errors
        if (lastError.message.includes('Invalid Tautulli API response')) {
          throw lastError;
        }

        // Wait before retrying (exponential backoff)
        if (attempt < MAX_RETRIES) {
          const delay = RETRY_DELAY_MS * attempt;
          console.warn(
            `Tautulli API request failed (attempt ${attempt}/${MAX_RETRIES}), retrying in ${delay}ms...`
          );
          await new Promise((resolve) => setTimeout(resolve, delay));
        }
      }
    }

    throw lastError ?? new Error('Tautulli API request failed after retries');
  }

  /**
   * Test connection to Tautulli
   */
  async testConnection(): Promise<boolean> {
    try {
      const result = await this.request<{ response: { result: string } }>('arnold');
      return result.response.result === 'success';
    } catch (err) {
      console.warn('[Tautulli] Connection test failed:', err instanceof Error ? err.message : err);
      return false;
    }
  }

  /**
   * Get all users from Tautulli
   */
  async getUsers(): Promise<TautulliUserRecord[]> {
    const result = await this.request<TautulliUsersResponse>(
      'get_users',
      {},
      TautulliUsersResponseSchema
    );
    return result.response.data ?? [];
  }

  /**
   * Get paginated history from Tautulli
   */
  async getHistory(
    start: number = 0,
    length: number = PAGE_SIZE
  ): Promise<{ records: TautulliHistoryRecord[]; total: number }> {
    const result = await this.request<TautulliHistoryResponse>(
      'get_history',
      {
        start,
        length,
        order_column: 'date',
        order_dir: 'desc',
      },
      TautulliHistoryResponseSchema
    );

    return {
      records: result.response.data?.data ?? [],
      // Use recordsFiltered (not recordsTotal) - Tautulli applies grouping/filtering by default
      total: result.response.data?.recordsFiltered ?? 0,
    };
  }

  /**
   * Import all history from Tautulli into Tracearr (OPTIMIZED)
   *
   * Performance improvements over original:
   * - Pre-fetches all existing sessions (1 query vs N queries for dedup)
   * - Batches INSERT operations (100 per batch vs individual inserts)
   * - Batches UPDATE operations in transactions
   * - Caches GeoIP lookups per IP address
   * - Throttles WebSocket updates (every 100 records or 2 seconds)
   * - Extends BullMQ lock on progress to prevent stalls with large imports
   */
  static async importHistory(
    serverId: string,
    pubSubService?: PubSubService,
    onProgress?: (progress: TautulliImportProgress) => Promise<void>,
    options?: { overwriteFriendlyNames?: boolean }
  ): Promise<TautulliImportResult> {
    const overwriteFriendlyNames = options?.overwriteFriendlyNames ?? false;

    // Get Tautulli settings
    const settingsRow = await db.select().from(settings).where(eq(settings.id, 1)).limit(1);

    const config = settingsRow[0];
    if (!config?.tautulliUrl || !config?.tautulliApiKey) {
      return {
        success: false,
        imported: 0,
        updated: 0,
        linked: 0,
        skipped: 0,
        errors: 0,
        message: 'Tautulli is not configured. Please add URL and API key in Settings.',
      };
    }

    const tautulli = new TautulliService(config.tautulliUrl, config.tautulliApiKey);

    // Test connection
    const connected = await tautulli.testConnection();
    if (!connected) {
      return {
        success: false,
        imported: 0,
        updated: 0,
        linked: 0,
        skipped: 0,
        errors: 0,
        message: 'Failed to connect to Tautulli. Please check URL and API key.',
      };
    }

    // Initialize progress with detailed tracking
    const progress: TautulliImportProgress = {
      status: 'fetching',
      totalRecords: 0,
      fetchedRecords: 0,
      processedRecords: 0,
      importedRecords: 0,
      updatedRecords: 0,
      skippedRecords: 0,
      duplicateRecords: 0,
      unknownUserRecords: 0,
      activeSessionRecords: 0,
      errorRecords: 0,
      currentPage: 0,
      totalPages: 0,
      message: 'Connecting to Tautulli...',
    };

    // Create progress publisher using shared module
    const publishProgress = createSimpleProgressPublisher(
      pubSubService,
      'import:progress',
      onProgress
    );

    publishProgress(progress);

    // Sync friendly/custom names from Tautulli before importing history
    progress.message = 'Syncing user display names from Tautulli...';
    publishProgress(progress);

    try {
      const updatedNames = await TautulliService.syncFriendlyNamesFromTautulli(
        serverId,
        tautulli,
        overwriteFriendlyNames
      );
      if (updatedNames > 0) {
        console.log(`[Import] Updated ${updatedNames} user display names from Tautulli`);
      }
    } catch (err) {
      console.warn('[Import] Failed to sync Tautulli friendly names:', err);
    }

    // Get user mapping using shared module
    const userMapRaw = await createUserMapping(serverId);
    // Convert to number keys for Tautulli (Plex uses numeric user IDs)
    const userMap = new Map<number, string>();
    for (const [externalId, userId] of userMapRaw) {
      // Strict numeric validation to prevent parseInt('123abc') -> 123
      if (/^\d+$/.test(externalId)) {
        userMap.set(parseInt(externalId, 10), userId);
      }
    }

    // Get total count
    const { total } = await tautulli.getHistory(0, 1);
    progress.totalRecords = total;
    progress.totalPages = Math.ceil(total / PAGE_SIZE);
    progress.message = `Found ${total} records to import`;
    publishProgress(progress);

    // Track externalSessionIds we've already inserted in THIS import run
    const insertedThisRun = new Set<string>();

    // Track sessions that need referenceId linking (child → parent external IDs)
    // group_ids from Tautulli contains comma-separated session IDs in the same viewing chain
    const sessionGroupLinks: Array<{ childExternalId: string; parentExternalId: string }> = [];

    // Track skipped users using shared module
    const skippedUserTracker = createSkippedUserTracker();

    console.log('[Import] Using per-page dedup queries (memory-efficient mode)');

    // GeoIP cache (bounded - cleared every 10 pages to prevent unbounded growth)
    let geoCache = new Map<string, ReturnType<typeof geoipService.lookup>>();

    // Batch collections
    const insertBatch: (typeof sessions.$inferInsert)[] = [];
    const updateBatch: SessionUpdate[] = [];

    let imported = 0;
    let updated = 0;
    let skipped = 0;
    let errors = 0;
    let page = 0;

    // Throttle tracking for progress updates
    let lastProgressTime = Date.now();

    // Helper to flush batches using shared modules
    const flushBatches = async () => {
      if (insertBatch.length > 0) {
        await flushInsertBatch(insertBatch);
        insertBatch.length = 0;
      }
      if (updateBatch.length > 0) {
        await flushUpdateBatch(updateBatch);
        updateBatch.length = 0;
      }
    };

    // Process all pages
    while (page * PAGE_SIZE < total) {
      progress.status = 'processing';
      progress.currentPage = page + 1;
      progress.message = `Processing page ${page + 1} of ${progress.totalPages}`;

      // Clear geo cache periodically to prevent unbounded growth (every 10 pages)
      if (page > 0 && page % 10 === 0) {
        geoCache = new Map();
      }

      const { records } = await tautulli.getHistory(page * PAGE_SIZE, PAGE_SIZE);

      // Track actual records fetched (may differ from API total if records changed)
      progress.fetchedRecords += records.length;

      // === Per-page dedup queries using shared modules ===
      const pageRefIds: string[] = [];
      const pageTimeKeys: Array<{ serverUserId: string; ratingKey: string; startedAt: Date }> = [];

      for (const record of records) {
        if (record.reference_id !== null) {
          pageRefIds.push(String(record.reference_id));
        }
        const serverUserId = userMap.get(record.user_id);
        const ratingKey = typeof record.rating_key === 'number' ? String(record.rating_key) : null;
        if (serverUserId && ratingKey) {
          pageTimeKeys.push({
            serverUserId,
            ratingKey,
            startedAt: new Date(record.started * 1000),
          });
        }
      }

      // Query existing sessions for this page using shared modules
      const sessionByExternalId = await queryExistingByExternalIds(serverId, pageRefIds);
      const sessionByTimeKey = await queryExistingByTimeKeys(serverId, pageTimeKeys);

      for (const record of records) {
        progress.processedRecords++;

        try {
          // Find Tracearr server user by Plex user ID
          const serverUserId = userMap.get(record.user_id);
          if (!serverUserId) {
            skippedUserTracker.track(
              record.user_id,
              record.friendly_name || record.user || 'Unknown'
            );
            skipped++;
            progress.skippedRecords++;
            progress.unknownUserRecords++;
            continue;
          }

          // Skip records without reference_id (active/in-progress sessions)
          if (record.reference_id === null) {
            skipped++;
            progress.skippedRecords++;
            progress.activeSessionRecords++;
            continue;
          }

          const referenceIdStr = String(record.reference_id);

          // Skip if we already inserted this in a previous page of THIS import run
          if (insertedThisRun.has(referenceIdStr)) {
            skipped++;
            progress.skippedRecords++;
            progress.duplicateRecords++;
            continue;
          }

          // Check if exists in database (per-page query result)
          const existingByRef = sessionByExternalId.get(referenceIdStr);
          if (existingByRef) {
            // Calculate new values
            const newStoppedAt = new Date((record.started + record.duration) * 1000);
            const newDurationMs = record.duration * 1000;
            const newPausedDurationMs = record.paused_counter * 1000;
            const newWatched = record.watched_status === 1;
            const newProgressMs = Math.round(
              (record.percent_complete / 100) * (existingByRef.totalDurationMs ?? 0)
            );

            // Only update if something actually changed
            const stoppedAtChanged = existingByRef.stoppedAt?.getTime() !== newStoppedAt.getTime();
            const durationChanged = existingByRef.durationMs !== newDurationMs;
            const pausedChanged = existingByRef.pausedDurationMs !== newPausedDurationMs;
            const watchedChanged = existingByRef.watched !== newWatched;

            if (stoppedAtChanged || durationChanged || pausedChanged || watchedChanged) {
              updateBatch.push({
                id: existingByRef.id,
                stoppedAt: newStoppedAt,
                durationMs: newDurationMs,
                pausedDurationMs: newPausedDurationMs,
                watched: newWatched,
                progressMs: newProgressMs,
              });
              updated++;
              progress.updatedRecords++;
            } else {
              skipped++;
              progress.skippedRecords++;
              progress.duplicateRecords++;
            }

            // Still collect group links for existing records (to fix historical data)
            if (record.group_count && record.group_count > 1 && record.group_ids) {
              const groupIds = record.group_ids.split(',').map((id) => id.trim());
              const parentExternalId = groupIds[0];
              if (parentExternalId && parentExternalId !== referenceIdStr) {
                sessionGroupLinks.push({
                  childExternalId: referenceIdStr,
                  parentExternalId,
                });
              }
            }
            continue;
          }

          // Fallback dedup check by time-based key
          const startedAt = new Date(record.started * 1000);
          const ratingKeyStr =
            typeof record.rating_key === 'number' ? String(record.rating_key) : null;

          if (ratingKeyStr) {
            const timeKeyStr = createTimeKey(serverUserId, ratingKeyStr, startedAt);
            const existingByTime = sessionByTimeKey.get(timeKeyStr);

            if (existingByTime) {
              const newStoppedAt = new Date((record.started + record.duration) * 1000);
              const newDurationMs = record.duration * 1000;
              const newPausedDurationMs = record.paused_counter * 1000;
              const newWatched = record.watched_status === 1;

              const needsExternalId = !existingByTime.externalSessionId;
              const stoppedAtChanged =
                existingByTime.stoppedAt?.getTime() !== newStoppedAt.getTime();
              const durationChanged = existingByTime.durationMs !== newDurationMs;
              const pausedChanged = existingByTime.pausedDurationMs !== newPausedDurationMs;
              const watchedChanged = existingByTime.watched !== newWatched;

              if (
                needsExternalId ||
                stoppedAtChanged ||
                durationChanged ||
                pausedChanged ||
                watchedChanged
              ) {
                updateBatch.push({
                  id: existingByTime.id,
                  externalSessionId: referenceIdStr,
                  stoppedAt: newStoppedAt,
                  durationMs: newDurationMs,
                  pausedDurationMs: newPausedDurationMs,
                  watched: newWatched,
                });
                updated++;
                progress.updatedRecords++;
              } else {
                skipped++;
                progress.skippedRecords++;
                progress.duplicateRecords++;
              }

              // Still collect group links for existing records (to fix historical data)
              if (record.group_count && record.group_count > 1 && record.group_ids) {
                const groupIds = record.group_ids.split(',').map((id) => id.trim());
                const parentExternalId = groupIds[0];
                if (parentExternalId && parentExternalId !== referenceIdStr) {
                  sessionGroupLinks.push({
                    childExternalId: referenceIdStr,
                    parentExternalId,
                  });
                }
              }
              continue;
            }
          }

          // Cached GeoIP lookup
          const ipForLookup = record.ip_address ?? '0.0.0.0';
          let geo = geoCache.get(ipForLookup);
          if (!geo) {
            geo = geoipService.lookup(ipForLookup);
            geoCache.set(ipForLookup, geo);
          }

          // Map media type - check live flag FIRST (live content reports as movie/episode)
          let mediaType: 'movie' | 'episode' | 'track' | 'live' = 'movie';
          if (record.live === 1) {
            mediaType = 'live';
          } else if (record.media_type === 'episode') {
            mediaType = 'episode';
          } else if (record.media_type === 'track') {
            mediaType = 'track';
          }

          // Music-specific fields (only for tracks)
          const isMusic = record.media_type === 'track';
          const artistName = isMusic ? record.grandparent_title || null : null;
          const albumName = isMusic ? record.parent_title || null : null;
          const trackNumber =
            isMusic && typeof record.media_index === 'number' ? record.media_index : null;
          const discNumber =
            isMusic && typeof record.parent_media_index === 'number'
              ? record.parent_media_index
              : null;

          const sessionKey =
            record.session_key != null
              ? String(record.session_key)
              : `tautulli-${record.reference_id}`;

          // Track this insert to prevent duplicates within this import run
          insertedThisRun.add(referenceIdStr);

          // Collect insert
          insertBatch.push({
            serverId,
            serverUserId,
            sessionKey,
            ratingKey: ratingKeyStr,
            externalSessionId: referenceIdStr,
            state: 'stopped',
            mediaType,
            mediaTitle: record.title,
            grandparentTitle: record.grandparent_title || null,
            seasonNumber:
              typeof record.parent_media_index === 'number' ? record.parent_media_index : null,
            episodeNumber: typeof record.media_index === 'number' ? record.media_index : null,
            year: record.year || null,
            thumbPath: record.thumb || null,
            startedAt,
            lastSeenAt: startedAt,
            stoppedAt: new Date((record.started + record.duration) * 1000),
            durationMs: record.duration * 1000,
            // Calculate totalDurationMs from duration and percent_complete
            // e.g., if 441s watched = 44%, total = 441/0.44 = 1002s
            totalDurationMs:
              record.percent_complete > 0
                ? Math.round((record.duration * 1000 * 100) / record.percent_complete)
                : null,
            // For imported sessions, progressMs ≈ durationMs (assumes linear playback)
            progressMs: record.duration * 1000,
            pausedDurationMs: record.paused_counter * 1000,
            watched: record.watched_status === 1,
            ipAddress: record.ip_address || '0.0.0.0',
            geoCity: geo.city,
            geoRegion: geo.region,
            geoCountry: geo.countryCode ?? geo.country,
            geoLat: geo.lat,
            geoLon: geo.lon,
            playerName: record.player || record.product,
            deviceId: record.machine_id || null,
            product: record.product || null,
            platform: normalizePlatformName(record.platform || ''),
            // Tautulli uses single transcode_decision for both video/audio
            ...(() => {
              const { videoDecision, audioDecision, isTranscode } = normalizeStreamDecisions(
                record.transcode_decision,
                record.transcode_decision
              );
              return {
                quality: isTranscode ? 'Transcode' : 'Direct',
                isTranscode,
                videoDecision,
                audioDecision,
              };
            })(),
            bitrate: null,
            // Music fields (only populated for tracks)
            artistName,
            albumName,
            trackNumber,
            discNumber,
            // Live TV fields (not available in get_history API - would require get_stream_data)
            channelTitle: null,
            channelIdentifier: null,
            channelThumb: null,
          });

          // Track session grouping for referenceId linking
          // group_ids contains comma-separated Tautulli row IDs (e.g., "12351,12362")
          // The first ID is the "parent" session in the resume chain
          if (record.group_count && record.group_count > 1 && record.group_ids) {
            const groupIds = record.group_ids.split(',').map((id) => id.trim());
            const parentExternalId = groupIds[0];
            // Only link if this session is NOT the parent (avoid self-reference)
            if (parentExternalId && parentExternalId !== referenceIdStr) {
              sessionGroupLinks.push({
                childExternalId: referenceIdStr,
                parentExternalId,
              });
            }
          }

          imported++;
          progress.importedRecords++;
        } catch (error) {
          console.error('Error processing record:', record.reference_id, error);
          errors++;
          progress.errorRecords++;
        }

        // Throttled progress updates
        const now = Date.now();
        if (progress.processedRecords % 100 === 0 || now - lastProgressTime > 2000) {
          publishProgress(progress);
          lastProgressTime = now;
        }
      }

      // Flush batches at end of each page
      await flushBatches();

      page++;
    }

    // Final flush for any remaining records
    await flushBatches();

    // Link sessions using group_ids data (referenceId linking pass)
    let linkedSessions = 0;
    if (sessionGroupLinks.length > 0) {
      progress.message = `Linking ${sessionGroupLinks.length} resume sessions...`;
      publishProgress(progress);

      // Get unique parent external IDs to lookup
      const parentExternalIds = [...new Set(sessionGroupLinks.map((l) => l.parentExternalId))];
      const parentMap = await queryExistingByExternalIds(serverId, parentExternalIds);

      // Also get child external IDs to find their UUIDs for updating
      const childExternalIds = sessionGroupLinks.map((l) => l.childExternalId);
      const childMap = await queryExistingByExternalIds(serverId, childExternalIds);

      // Batch update child sessions with their referenceId
      const UPDATE_CHUNK_SIZE = 50;
      for (let i = 0; i < sessionGroupLinks.length; i += UPDATE_CHUNK_SIZE) {
        const chunk = sessionGroupLinks.slice(i, i + UPDATE_CHUNK_SIZE);
        await Promise.all(
          chunk.map(async ({ childExternalId, parentExternalId }) => {
            const parent = parentMap.get(parentExternalId);
            const child = childMap.get(childExternalId);
            if (parent && child) {
              await db
                .update(sessions)
                .set({ referenceId: parent.id })
                .where(eq(sessions.id, child.id));
              linkedSessions++;
            }
          })
        );
      }

      if (linkedSessions > 0) {
        console.log(`[Import] Linked ${linkedSessions} sessions via group_ids`);
      }
    }

    // Refresh TimescaleDB aggregates so imported data appears in stats immediately
    progress.message = 'Refreshing aggregates...';
    publishProgress(progress);
    try {
      await refreshAggregates();
    } catch (err) {
      console.warn('Failed to refresh aggregates after import:', err);
    }

    // Build final message with detailed breakdown
    const parts: string[] = [];
    if (imported > 0) parts.push(`${imported} new`);
    if (updated > 0) parts.push(`${updated} updated`);
    if (linkedSessions > 0) parts.push(`${linkedSessions} linked`);
    if (skipped > 0) parts.push(`${skipped} skipped`);
    if (errors > 0) parts.push(`${errors} errors`);

    let message = `Import complete: ${parts.join(', ')}`;

    // Add skipped users warning using shared module
    const skippedUserWarning = skippedUserTracker.formatWarning();
    if (skippedUserWarning) {
      message += `. Warning: ${skippedUserWarning}`;
      console.warn(
        `Tautulli import skipped users: ${skippedUserTracker
          .getAll()
          .map((u) => u.username)
          .join(', ')}`
      );
    }

    // Final progress update
    progress.status = 'complete';
    progress.message = message;
    publishProgress(progress);

    return {
      success: true,
      imported,
      updated,
      linked: linkedSessions,
      skipped,
      errors,
      message,
      skippedUsers:
        skippedUserTracker.size > 0
          ? skippedUserTracker.getAll().map((u) => ({
              tautulliUserId: parseInt(u.externalId, 10),
              username: u.username ?? 'Unknown',
              recordCount: u.count,
            }))
          : undefined,
    };
  }
}
