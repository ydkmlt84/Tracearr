-- ============================================================================
-- Engagement Tracking System Migration
-- ============================================================================
-- This migration adds views for engagement tracking.
-- It's non-destructive - sessions table remains the source of truth.
--
-- Key features:
-- - 2-minute minimum duration filter (Netflix "intent" threshold)
-- - Episode rollup to show-level statistics
-- - Netflix-style play counting (cumulative_time / duration)
-- - Engagement tiers (abandoned -> rewatched)
-- - User behavior classification
--
-- NOTE: This creates a standard materialized view that works without TimescaleDB.
-- When TimescaleDB is available, initTimescaleDB() replaces this with a
-- continuous aggregate for automatic incremental refresh.
-- ============================================================================

-- ============================================================================
-- PHASE 1: Daily Content Watch Time (Standard Materialized View)
-- ============================================================================
-- Filters out sessions < 2 minutes and aggregates by day/user/content
-- Uses date_trunc instead of time_bucket for PostgreSQL compatibility

CREATE MATERIALIZED VIEW IF NOT EXISTS daily_content_engagement AS
SELECT
  date_trunc('day', started_at) AS day,
  server_user_id,
  rating_key,
  -- Content metadata (use MAX to get consistent values)
  MAX(media_title) AS media_title,
  MAX(grandparent_title) AS show_title,
  MAX(media_type) AS media_type,
  MAX(total_duration_ms) AS content_duration_ms,
  MAX(thumb_path) AS thumb_path,
  MAX(server_id::text)::uuid AS server_id,
  MAX(season_number) AS season_number,
  MAX(episode_number) AS episode_number,
  MAX(year) AS year,
  -- Only count sessions >= 2 minutes (120000ms) as valid engagement
  -- This filters out previews, accidental clicks, quality change artifacts
  SUM(CASE WHEN duration_ms >= 120000 THEN duration_ms ELSE 0 END) AS watched_ms,
  COUNT(*) FILTER (WHERE duration_ms >= 120000) AS valid_session_count,
  COUNT(*) AS total_session_count,
  -- Track if any session was marked as "watched" by the media server
  BOOL_OR(watched) AS any_marked_watched
FROM sessions
WHERE rating_key IS NOT NULL
  AND total_duration_ms > 0  -- Only content with known duration
GROUP BY date_trunc('day', started_at), server_user_id, rating_key
WITH NO DATA;

--> statement-breakpoint

-- ============================================================================
-- PHASE 2: Content Engagement Summary View
-- ============================================================================
-- Aggregates all daily data into per-user-per-content engagement metrics

CREATE OR REPLACE VIEW content_engagement_summary AS
SELECT
  server_user_id,
  rating_key,
  -- Content metadata
  MAX(media_title) AS media_title,
  MAX(show_title) AS show_title,
  MAX(media_type) AS media_type,
  MAX(content_duration_ms) AS content_duration_ms,
  MAX(thumb_path) AS thumb_path,
  MAX(server_id::text)::uuid AS server_id,
  MAX(season_number) AS season_number,
  MAX(episode_number) AS episode_number,
  MAX(year) AS year,
  -- Aggregated watch time (only from valid sessions >= 2 min)
  SUM(watched_ms) AS cumulative_watched_ms,
  SUM(valid_session_count) AS valid_sessions,
  SUM(total_session_count) AS total_sessions,
  MIN(day) AS first_watched_at,
  MAX(day) AS last_watched_at,
  BOOL_OR(any_marked_watched) AS ever_marked_watched,
  -- Derived: completion percentage
  CASE
    WHEN MAX(content_duration_ms) > 0 THEN
      ROUND(100.0 * SUM(watched_ms) / MAX(content_duration_ms), 1)
    ELSE 0
  END AS completion_pct,
  -- Derived: Netflix-style play count (watched_time / duration)
  CASE
    WHEN MAX(content_duration_ms) > 0 THEN
      GREATEST(0, FLOOR(SUM(watched_ms)::float / MAX(content_duration_ms)))::int
    ELSE 0
  END AS plays,
  -- Derived: engagement tier based on cumulative completion
  CASE
    WHEN MAX(content_duration_ms) > 0 THEN
      CASE
        WHEN SUM(watched_ms) >= MAX(content_duration_ms) * 2.0 THEN 'rewatched'  -- 200%+
        WHEN SUM(watched_ms) >= MAX(content_duration_ms) * 1.0 THEN 'finished'   -- 100%+
        WHEN SUM(watched_ms) >= MAX(content_duration_ms) * 0.8 THEN 'completed'  -- 80-99%
        WHEN SUM(watched_ms) >= MAX(content_duration_ms) * 0.5 THEN 'engaged'    -- 50-79%
        WHEN SUM(watched_ms) >= MAX(content_duration_ms) * 0.2 THEN 'sampled'    -- 20-49%
        ELSE 'abandoned'  -- < 20%
      END
    ELSE 'unknown'
  END AS engagement_tier
FROM daily_content_engagement
GROUP BY server_user_id, rating_key;

--> statement-breakpoint

-- ============================================================================
-- PHASE 3A: Episode Continuity Stats (Consecutive Episode Detection)
-- ============================================================================
-- Calculates back-to-back episode watching patterns using window functions
-- A "consecutive" episode is one that started within 30 minutes of the previous ending

CREATE OR REPLACE VIEW episode_continuity_stats AS
WITH episode_timeline AS (
  SELECT
    server_user_id,
    grandparent_title AS show_title,
    rating_key,
    started_at,
    stopped_at,
    -- Time since previous episode ended (for same user/show)
    EXTRACT(EPOCH FROM (
      started_at - LAG(stopped_at) OVER (
        PARTITION BY server_user_id, grandparent_title
        ORDER BY started_at
      )
    )) / 60 AS gap_minutes
  FROM sessions
  WHERE media_type = 'episode'
    AND grandparent_title IS NOT NULL
    AND duration_ms >= 120000  -- Valid sessions only (2+ minutes)
    AND stopped_at IS NOT NULL
)
SELECT
  server_user_id,
  show_title,
  COUNT(*) AS total_episode_watches,
  -- Count episodes that started within 30 min of previous ending
  COUNT(*) FILTER (WHERE gap_minutes IS NOT NULL AND gap_minutes <= 30) AS consecutive_episodes,
  -- Consecutive percentage (exclude first episode which has no gap)
  ROUND(100.0 * COUNT(*) FILTER (WHERE gap_minutes IS NOT NULL AND gap_minutes <= 30)
        / NULLIF(COUNT(*) - 1, 0), 1) AS consecutive_pct,
  -- Average gap between episodes (capped at 8 hours to exclude long breaks)
  ROUND(AVG(gap_minutes) FILTER (WHERE gap_minutes IS NOT NULL AND gap_minutes <= 480), 1) AS avg_gap_minutes
FROM episode_timeline
GROUP BY server_user_id, show_title
HAVING COUNT(*) >= 2;  -- Need at least 2 episodes for continuity analysis

--> statement-breakpoint

-- ============================================================================
-- PHASE 3B: Daily Show Intensity (Episodes per Day)
-- ============================================================================
-- Aggregates daily_content_engagement to get daily episode counts per user/show

CREATE OR REPLACE VIEW daily_show_intensity AS
SELECT
  server_user_id,
  show_title,
  day,
  COUNT(DISTINCT rating_key) AS episodes_watched_this_day
FROM daily_content_engagement
WHERE media_type = 'episode'
  AND show_title IS NOT NULL
  AND valid_session_count > 0
GROUP BY server_user_id, show_title, day;

--> statement-breakpoint

-- ============================================================================
-- PHASE 3: Show-Level Engagement Summary (Episode Rollup)
-- ============================================================================
-- Aggregates episodes by show (grandparent_title) for TV series stats
-- Now includes daily intensity metrics for binge score calculation

CREATE OR REPLACE VIEW show_engagement_summary AS
WITH intensity_stats AS (
  SELECT
    server_user_id,
    show_title,
    COUNT(DISTINCT day) AS total_viewing_days,
    MAX(episodes_watched_this_day) AS max_episodes_in_one_day,
    ROUND(AVG(episodes_watched_this_day), 1) AS avg_episodes_per_viewing_day
  FROM daily_show_intensity
  GROUP BY server_user_id, show_title
)
SELECT
  ces.server_user_id,
  ces.show_title,
  MAX(ces.server_id::text)::uuid AS server_id,
  MAX(ces.thumb_path) AS thumb_path,
  MAX(ces.year) AS year,
  -- Episode counts
  COUNT(DISTINCT ces.rating_key) AS unique_episodes_watched,
  COUNT(DISTINCT CONCAT(ces.season_number, '-', ces.episode_number)) AS unique_episode_numbers,
  -- Aggregate watch stats
  SUM(ces.plays) AS total_episode_plays,
  SUM(ces.cumulative_watched_ms) AS total_watched_ms,
  ROUND(SUM(ces.cumulative_watched_ms) / 1000.0 / 60 / 60, 1) AS total_watch_hours,
  SUM(ces.valid_sessions) AS total_valid_sessions,
  SUM(ces.total_sessions) AS total_all_sessions,
  -- Date range
  MIN(ces.first_watched_at) AS first_watched_at,
  MAX(ces.last_watched_at) AS last_watched_at,
  -- Viewing span in days
  EXTRACT(DAYS FROM (MAX(ces.last_watched_at) - MIN(ces.first_watched_at)))::int AS viewing_span_days,
  -- Daily intensity metrics (from CTE)
  COALESCE(ist.total_viewing_days, 1) AS total_viewing_days,
  COALESCE(ist.max_episodes_in_one_day, 1) AS max_episodes_in_one_day,
  COALESCE(ist.avg_episodes_per_viewing_day, 1.0) AS avg_episodes_per_viewing_day,
  -- Engagement breakdown per episode
  COUNT(*) FILTER (WHERE ces.engagement_tier IN ('completed', 'finished', 'rewatched')) AS completed_episodes,
  COUNT(*) FILTER (WHERE ces.engagement_tier = 'abandoned') AS abandoned_episodes,
  -- Show-level completion rate (what % of episodes started did user finish?)
  ROUND(100.0 * COUNT(*) FILTER (WHERE ces.engagement_tier IN ('completed', 'finished', 'rewatched'))
        / NULLIF(COUNT(*), 0), 1) AS episode_completion_rate
FROM content_engagement_summary ces
LEFT JOIN intensity_stats ist ON ces.server_user_id = ist.server_user_id AND ces.show_title = ist.show_title
WHERE ces.media_type = 'episode' AND ces.show_title IS NOT NULL
GROUP BY ces.server_user_id, ces.show_title, ist.total_viewing_days, ist.max_episodes_in_one_day, ist.avg_episodes_per_viewing_day;

--> statement-breakpoint

-- ============================================================================
-- PHASE 4: Top Content by Plays View
-- ============================================================================
-- Aggregates engagement across all users for content-level stats

CREATE OR REPLACE VIEW top_content_by_plays AS
SELECT
  rating_key,
  media_title,
  show_title,
  media_type,
  content_duration_ms,
  thumb_path,
  server_id,
  year,
  -- Aggregate metrics across all users
  SUM(plays) AS total_plays,
  SUM(cumulative_watched_ms) AS total_watched_ms,
  ROUND(SUM(cumulative_watched_ms) / 1000.0 / 60 / 60, 1) AS total_watch_hours,
  COUNT(DISTINCT server_user_id) AS unique_viewers,
  SUM(valid_sessions) AS total_valid_sessions,
  SUM(total_sessions) AS total_all_sessions,
  -- Engagement tier breakdown
  COUNT(*) FILTER (WHERE engagement_tier IN ('completed', 'finished', 'rewatched')) AS completions,
  COUNT(*) FILTER (WHERE engagement_tier = 'rewatched') AS rewatches,
  COUNT(*) FILTER (WHERE engagement_tier = 'abandoned') AS abandonments,
  COUNT(*) FILTER (WHERE engagement_tier = 'sampled') AS samples,
  -- Engagement rates
  ROUND(100.0 * COUNT(*) FILTER (WHERE engagement_tier IN ('completed', 'finished', 'rewatched'))
        / NULLIF(COUNT(*), 0), 1) AS completion_rate,
  ROUND(100.0 * COUNT(*) FILTER (WHERE engagement_tier = 'abandoned')
        / NULLIF(COUNT(*), 0), 1) AS abandonment_rate
FROM content_engagement_summary
GROUP BY rating_key, media_title, show_title, media_type, content_duration_ms, thumb_path, server_id, year;

--> statement-breakpoint

-- ============================================================================
-- PHASE 5: Top Shows by Engagement View (Episode Rollup)
-- ============================================================================
-- Aggregates show-level stats across all users with enhanced binge score

CREATE OR REPLACE VIEW top_shows_by_engagement AS
SELECT
  ses.show_title,
  MAX(ses.server_id::text)::uuid AS server_id,
  MAX(ses.thumb_path) AS thumb_path,
  MAX(ses.year) AS year,
  -- Aggregate across all users
  SUM(ses.unique_episodes_watched) AS total_episode_views,
  SUM(ses.total_watch_hours) AS total_watch_hours,
  COUNT(DISTINCT ses.server_user_id) AS unique_viewers,
  SUM(ses.total_valid_sessions) AS total_valid_sessions,
  SUM(ses.total_all_sessions) AS total_all_sessions,
  -- Average engagement per viewer
  ROUND(AVG(ses.unique_episodes_watched), 1) AS avg_episodes_per_viewer,
  ROUND(AVG(ses.episode_completion_rate), 1) AS avg_completion_rate,
  -- Daily intensity metrics
  ROUND(AVG(ses.avg_episodes_per_viewing_day), 1) AS avg_daily_intensity,
  ROUND(AVG(ses.max_episodes_in_one_day), 1) AS avg_max_daily_episodes,
  -- Continuity metrics (from episode_continuity_stats)
  ROUND(AVG(COALESCE(ecs.consecutive_pct, 0)), 1) AS avg_consecutive_pct,
  -- Velocity: episodes per week (based on viewing span)
  ROUND(AVG(
    CASE
      WHEN ses.viewing_span_days > 0 THEN ses.unique_episodes_watched / (ses.viewing_span_days / 7.0)
      ELSE ses.unique_episodes_watched * 7  -- If same day, assume weekly rate
    END
  ), 1) AS avg_velocity,
  -- Enhanced Binge Score (0-100 scale):
  -- 40% Volume×Quality + 30% Daily Intensity + 20% Continuity + 10% Velocity
  ROUND(
    (
      -- Volume × Quality component (40%): episodes watched × completion rate / 100, scaled to ~0-40
      LEAST(AVG(ses.unique_episodes_watched) * AVG(ses.episode_completion_rate) / 100, 40) * 1.0
      -- Daily Intensity component (30%): avg episodes per viewing day, scaled to ~0-30
      + LEAST(AVG(ses.avg_episodes_per_viewing_day) * 6, 30)
      -- Continuity component (20%): consecutive episode %, scaled to ~0-20
      + AVG(COALESCE(ecs.consecutive_pct, 0)) * 0.2
      -- Velocity component (10%): episodes per week, capped and scaled to ~0-10
      + LEAST(AVG(
          CASE
            WHEN ses.viewing_span_days > 0 THEN ses.unique_episodes_watched / (ses.viewing_span_days / 7.0)
            ELSE ses.unique_episodes_watched * 7
          END
        ), 20) * 0.5
    ),
  1) AS binge_score
FROM show_engagement_summary ses
LEFT JOIN episode_continuity_stats ecs
  ON ses.server_user_id = ecs.server_user_id AND ses.show_title = ecs.show_title
GROUP BY ses.show_title;

--> statement-breakpoint

-- ============================================================================
-- PHASE 6: User Engagement Profile View
-- ============================================================================
-- Per-user engagement patterns and behavior classification

CREATE OR REPLACE VIEW user_engagement_profile AS
SELECT
  server_user_id,
  -- Content consumption metrics
  COUNT(DISTINCT rating_key) AS content_started,
  SUM(plays) AS total_plays,
  SUM(cumulative_watched_ms)::bigint AS total_watched_ms,
  ROUND(SUM(cumulative_watched_ms) / 1000.0 / 60 / 60, 1) AS total_watch_hours,
  SUM(valid_sessions) AS valid_session_count,
  SUM(total_sessions) AS total_session_count,
  -- Engagement tier breakdown
  COUNT(*) FILTER (WHERE engagement_tier = 'abandoned') AS abandoned_count,
  COUNT(*) FILTER (WHERE engagement_tier = 'sampled') AS sampled_count,
  COUNT(*) FILTER (WHERE engagement_tier = 'engaged') AS engaged_count,
  COUNT(*) FILTER (WHERE engagement_tier IN ('completed', 'finished')) AS completed_count,
  COUNT(*) FILTER (WHERE engagement_tier = 'rewatched') AS rewatched_count,
  -- Overall completion rate
  ROUND(100.0 * COUNT(*) FILTER (WHERE engagement_tier IN ('completed', 'finished', 'rewatched'))
        / NULLIF(COUNT(*), 0), 1) AS completion_rate,
  -- User behavior classification
  CASE
    WHEN COUNT(*) = 0 THEN 'inactive'
    WHEN COUNT(*) FILTER (WHERE engagement_tier = 'rewatched') > COUNT(*) * 0.2 THEN 'rewatcher'
    WHEN COUNT(*) FILTER (WHERE engagement_tier IN ('completed', 'finished', 'rewatched')) > COUNT(*) * 0.7 THEN 'completionist'
    WHEN COUNT(*) FILTER (WHERE engagement_tier = 'abandoned') > COUNT(*) * 0.5 THEN 'sampler'
    ELSE 'casual'
  END AS behavior_type,
  -- Favorite media type (mode)
  MODE() WITHIN GROUP (ORDER BY media_type) AS favorite_media_type
FROM content_engagement_summary
GROUP BY server_user_id;

--> statement-breakpoint

-- ============================================================================
-- PHASE 7: Time-filtered Engagement Function (for date range queries)
-- ============================================================================

CREATE OR REPLACE FUNCTION get_content_engagement(
  p_start_date timestamptz DEFAULT NULL,
  p_end_date timestamptz DEFAULT NULL,
  p_server_id uuid DEFAULT NULL,
  p_media_type varchar DEFAULT NULL
)
RETURNS TABLE (
  rating_key varchar,
  media_title text,
  show_title varchar,
  media_type varchar,
  thumb_path varchar,
  server_id uuid,
  year int,
  total_plays bigint,
  total_watched_ms bigint,
  unique_viewers bigint,
  valid_sessions bigint,
  total_sessions bigint,
  completions bigint,
  rewatches bigint,
  abandonments bigint,
  completion_rate numeric
) AS $$
BEGIN
  RETURN QUERY
  WITH filtered_data AS (
    SELECT
      d.rating_key,
      d.server_user_id,
      d.media_title,
      d.show_title,
      d.media_type,
      d.thumb_path,
      d.server_id,
      d.year,
      d.content_duration_ms,
      d.watched_ms,
      d.valid_session_count,
      d.total_session_count
    FROM daily_content_engagement d
    WHERE (p_start_date IS NULL OR d.day >= p_start_date)
      AND (p_end_date IS NULL OR d.day <= p_end_date)
      AND (p_server_id IS NULL OR d.server_id::uuid = p_server_id)
      AND (p_media_type IS NULL OR d.media_type = p_media_type)
  ),
  user_aggregates AS (
    SELECT
      f.rating_key,
      f.server_user_id,
      MAX(f.media_title) AS media_title,
      MAX(f.show_title) AS show_title,
      MAX(f.media_type) AS media_type,
      MAX(f.thumb_path) AS thumb_path,
      MAX(f.server_id)::uuid AS server_id,
      MAX(f.year) AS year,
      MAX(f.content_duration_ms) AS content_duration_ms,
      SUM(f.watched_ms) AS watched_ms,
      SUM(f.valid_session_count) AS valid_session_count,
      SUM(f.total_session_count) AS total_session_count
    FROM filtered_data f
    GROUP BY f.rating_key, f.server_user_id
  )
  SELECT
    u.rating_key,
    MAX(u.media_title) AS media_title,
    MAX(u.show_title) AS show_title,
    MAX(u.media_type) AS media_type,
    MAX(u.thumb_path) AS thumb_path,
    MAX(u.server_id) AS server_id,
    MAX(u.year) AS year,
    -- Calculate plays from cumulative watched time
    SUM(CASE
      WHEN u.content_duration_ms > 0 THEN
        GREATEST(0, FLOOR(u.watched_ms::float / u.content_duration_ms))
      ELSE 0
    END)::bigint AS total_plays,
    SUM(u.watched_ms)::bigint AS total_watched_ms,
    COUNT(DISTINCT u.server_user_id)::bigint AS unique_viewers,
    SUM(u.valid_session_count)::bigint AS valid_sessions,
    SUM(u.total_session_count)::bigint AS total_sessions,
    -- Engagement tiers
    COUNT(DISTINCT u.server_user_id) FILTER (
      WHERE u.watched_ms >= u.content_duration_ms * 0.8
    )::bigint AS completions,
    COUNT(DISTINCT u.server_user_id) FILTER (
      WHERE u.watched_ms >= u.content_duration_ms * 2.0
    )::bigint AS rewatches,
    COUNT(DISTINCT u.server_user_id) FILTER (
      WHERE u.watched_ms < u.content_duration_ms * 0.2
    )::bigint AS abandonments,
    -- Completion rate
    ROUND(100.0 * COUNT(DISTINCT u.server_user_id) FILTER (
      WHERE u.watched_ms >= u.content_duration_ms * 0.8
    ) / NULLIF(COUNT(DISTINCT u.server_user_id), 0), 1) AS completion_rate
  FROM user_aggregates u
  GROUP BY u.rating_key;
END;
$$ LANGUAGE plpgsql STABLE;

--> statement-breakpoint

-- ============================================================================
-- PHASE 8: Show-level Time-filtered Function
-- ============================================================================

CREATE OR REPLACE FUNCTION get_show_engagement(
  p_start_date timestamptz DEFAULT NULL,
  p_end_date timestamptz DEFAULT NULL,
  p_server_id uuid DEFAULT NULL
)
RETURNS TABLE (
  show_title varchar,
  thumb_path varchar,
  server_id uuid,
  year int,
  total_episode_views bigint,
  total_watch_hours numeric,
  unique_viewers bigint,
  avg_episodes_per_viewer numeric,
  avg_completion_rate numeric,
  binge_score numeric
) AS $$
BEGIN
  RETURN QUERY
  WITH filtered_episodes AS (
    SELECT * FROM get_content_engagement(p_start_date, p_end_date, p_server_id, 'episode')
  )
  SELECT
    f.show_title,
    MAX(f.thumb_path) AS thumb_path,
    MAX(f.server_id) AS server_id,
    MAX(f.year) AS year,
    SUM(f.total_plays)::bigint AS total_episode_views,
    ROUND(SUM(f.total_watched_ms) / 1000.0 / 60 / 60, 1) AS total_watch_hours,
    MAX(f.unique_viewers)::bigint AS unique_viewers,
    ROUND(COUNT(DISTINCT f.rating_key)::numeric / NULLIF(MAX(f.unique_viewers), 0), 1) AS avg_episodes_per_viewer,
    ROUND(100.0 * SUM(f.completions) / NULLIF(SUM(f.unique_viewers), 0), 1) AS avg_completion_rate,
    -- Simplified binge score for date-filtered queries (0-100 scale)
    -- Uses volume × quality formula without continuity data
    ROUND(
      LEAST(
        (COUNT(DISTINCT f.rating_key)::numeric / NULLIF(MAX(f.unique_viewers), 0)) *
        (100.0 * SUM(f.completions) / NULLIF(SUM(f.unique_viewers), 0)) / 100,
        100
      ),
    1) AS binge_score
  FROM filtered_episodes f
  WHERE f.show_title IS NOT NULL
  GROUP BY f.show_title;
END;
$$ LANGUAGE plpgsql STABLE;

-- NOTE: Initial backfill is handled by the refresh policy (runs every 15 minutes)
-- Manual backfill if needed: CALL refresh_continuous_aggregate('daily_content_engagement', NULL, NULL);
-- (Must be run outside a transaction)
