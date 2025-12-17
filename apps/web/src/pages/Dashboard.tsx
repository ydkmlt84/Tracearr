import { useState } from 'react';
import { Play, Clock, AlertTriangle, Tv, MapPin, Calendar, Users } from 'lucide-react';
import { MediaServerIcon } from '@/components/icons/MediaServerIcon';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { NowPlayingCard } from '@/components/sessions';
import { StreamCard } from '@/components/map';
import { SessionDetailSheet } from '@/components/history/SessionDetailSheet';
import { ServerResourceCharts } from '@/components/charts/ServerResourceCharts';
import { useDashboardStats, useActiveSessions } from '@/hooks/queries';
import { useServerStatistics } from '@/hooks/queries/useServers';
import { useServer } from '@/hooks/useServer';
import type { ActiveSession } from '@tracearr/shared';

export function Dashboard() {
  const { selectedServerId, selectedServer } = useServer();
  const { data: stats, isLoading: statsLoading } = useDashboardStats(selectedServerId);
  const { data: sessions } = useActiveSessions(selectedServerId);

  // Session detail sheet state
  const [selectedSession, setSelectedSession] = useState<ActiveSession | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);

  // Only show server resource stats for Plex servers
  const isPlexServer = selectedServer?.type === 'plex';

  // Poll server statistics only when viewing a Plex server
  const {
    data: serverStats,
    isLoading: statsChartLoading,
    averages,
  } = useServerStatistics(selectedServerId ?? undefined, isPlexServer);

  const activeCount = sessions?.length ?? 0;
  const hasActiveStreams = activeCount > 0;

  return (
    <div className="space-y-6">
      {/* Today Stats Section */}
      <section>
        <div className="mb-4 flex items-center gap-2">
          <Calendar className="h-5 w-5 text-primary" />
          <h2 className="text-lg font-semibold">Today</h2>
        </div>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {/* Alerts */}
          <Card>
            <CardContent className="flex items-center justify-between py-4">
              <div>
                <p className="text-sm font-medium text-muted-foreground">Alerts</p>
                {statsLoading ? (
                  <Skeleton className="h-7 w-12 mt-1" />
                ) : (
                  <div className="text-2xl font-bold">{stats?.alertsLast24h ?? 0}</div>
                )}
              </div>
              <AlertTriangle className="h-5 w-5 text-muted-foreground" />
            </CardContent>
          </Card>

          {/* Plays */}
          <Card>
            <CardContent className="flex items-center justify-between py-4">
              <div>
                <p className="text-sm font-medium text-muted-foreground">Plays</p>
                {statsLoading ? (
                  <Skeleton className="h-7 w-12 mt-1" />
                ) : (
                  <div className="text-2xl font-bold">{stats?.todayPlays ?? 0}</div>
                )}
              </div>
              <Play className="h-5 w-5 text-muted-foreground" />
            </CardContent>
          </Card>

          {/* Watch Time */}
          <Card>
            <CardContent className="flex items-center justify-between py-4">
              <div>
                <p className="text-sm font-medium text-muted-foreground">Watch Time</p>
                {statsLoading ? (
                  <Skeleton className="h-7 w-12 mt-1" />
                ) : (
                  <div className="text-2xl font-bold">
                    {stats?.watchTimeHours ?? 0}
                    <span className="text-lg font-normal text-muted-foreground">h</span>
                  </div>
                )}
              </div>
              <Clock className="h-5 w-5 text-muted-foreground" />
            </CardContent>
          </Card>

          {/* Active Users */}
          <Card>
            <CardContent className="flex items-center justify-between py-4">
              <div>
                <p className="text-sm font-medium text-muted-foreground">Active Users</p>
                {statsLoading ? (
                  <Skeleton className="h-7 w-12 mt-1" />
                ) : (
                  <div className="text-2xl font-bold">{stats?.activeUsersToday ?? 0}</div>
                )}
              </div>
              <Users className="h-5 w-5 text-muted-foreground" />
            </CardContent>
          </Card>
        </div>
      </section>

      {/* Now Playing Section */}
      <section>
        <div className="mb-4 flex items-center gap-2">
          <Tv className="h-5 w-5 text-muted-foreground" />
          <h2 className="text-lg font-semibold">Now Playing</h2>
          {hasActiveStreams && (
            <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-foreground">
              {activeCount} {activeCount === 1 ? 'stream' : 'streams'}
            </span>
          )}
        </div>

        {!sessions || sessions.length === 0 ? (
          <Card className="border-dashed">
            <CardContent className="flex flex-col items-center justify-center py-12">
              <div className="rounded-full bg-muted p-4">
                <Tv className="h-8 w-8 text-muted-foreground" />
              </div>
              <h3 className="mt-4 font-semibold">No active streams</h3>
              <p className="mt-1 text-sm text-muted-foreground">
                Active streams will appear here when users start watching
              </p>
            </CardContent>
          </Card>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {sessions.map((session) => (
              <NowPlayingCard
                key={session.id}
                session={session}
                onClick={() => {
                  setSelectedSession(session);
                  setSheetOpen(true);
                }}
              />
            ))}
          </div>
        )}
      </section>

      {/* Stream Map - only show when there are active streams */}
      {hasActiveStreams && (
        <section>
          <div className="mb-4 flex items-center gap-2">
            <MapPin className="h-5 w-5 text-primary" />
            <h2 className="text-lg font-semibold">Stream Locations</h2>
          </div>
          <Card className="overflow-hidden">
            <StreamCard sessions={sessions} height={320} />
          </Card>
        </section>
      )}

      {/* Server Resource Stats (Plex only) */}
      {isPlexServer && (
        <section>
          <div className="mb-4 flex items-center gap-2">
            <MediaServerIcon type="plex" className="h-5 w-5" />
            <h2 className="text-lg font-semibold">Server Resources</h2>
          </div>
          <ServerResourceCharts
            data={serverStats?.data}
            isLoading={statsChartLoading}
            averages={averages}
          />
        </section>
      )}

      {/* Session Detail Sheet */}
      <SessionDetailSheet
        session={selectedSession}
        open={sheetOpen}
        onOpenChange={setSheetOpen}
      />
    </div>
  );
}
