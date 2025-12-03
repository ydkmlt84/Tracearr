import { useState } from 'react';
import { Users as UsersIcon } from 'lucide-react';
import { PeriodSelector } from '@/components/ui/period-selector';
import { UserCard, UserRow } from '@/components/users';
import { Skeleton } from '@/components/ui/skeleton';
import { useTopUsers, type StatsPeriod } from '@/hooks/queries';

export function StatsUsers() {
  const [period, setPeriod] = useState<StatsPeriod>('month');
  const topUsers = useTopUsers(period);

  const users = topUsers.data ?? [];
  const podiumUsers = users.slice(0, 3);
  const listUsers = users.slice(3);

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Top Users</h1>
          <p className="text-sm text-muted-foreground">
            Leaderboard of your most active viewers
          </p>
        </div>
        <PeriodSelector value={period} onChange={setPeriod} />
      </div>

      {topUsers.isLoading ? (
        <div className="space-y-8">
          {/* Podium skeleton */}
          <div className="flex items-end justify-center gap-4">
            <Skeleton className="h-56 w-40 rounded-xl" />
            <Skeleton className="h-64 w-44 rounded-xl" />
            <Skeleton className="h-56 w-40 rounded-xl" />
          </div>
          {/* List skeleton */}
          <div className="space-y-2">
            {Array.from({ length: 5 }).map((_, i) => (
              <Skeleton key={i} className="h-16 w-full rounded-lg" />
            ))}
          </div>
        </div>
      ) : users.length === 0 ? (
        <div className="rounded-xl border border-dashed p-12 text-center">
          <UsersIcon className="mx-auto h-16 w-16 text-muted-foreground/50" />
          <h3 className="mt-4 text-lg font-semibold">No activity yet</h3>
          <p className="mt-1 text-muted-foreground">
            Start streaming to see your top users here
          </p>
        </div>
      ) : (
        <>
          {/* Podium - Top 3 */}
          <div className="flex items-end justify-center gap-4">
            {/* #2 - Left */}
            {podiumUsers[1] && (
              <UserCard
                userId={podiumUsers[1].serverUserId}
                username={podiumUsers[1].username}
                thumbUrl={podiumUsers[1].thumbUrl}
                serverId={podiumUsers[1].serverId}
                trustScore={podiumUsers[1].trustScore}
                playCount={podiumUsers[1].playCount}
                watchTimeHours={podiumUsers[1].watchTimeHours}
                topContent={podiumUsers[1].topContent}
                rank={2}
                className="w-40"
              />
            )}

            {/* #1 - Center (elevated) */}
            {podiumUsers[0] && (
              <UserCard
                userId={podiumUsers[0].serverUserId}
                username={podiumUsers[0].username}
                thumbUrl={podiumUsers[0].thumbUrl}
                serverId={podiumUsers[0].serverId}
                trustScore={podiumUsers[0].trustScore}
                playCount={podiumUsers[0].playCount}
                watchTimeHours={podiumUsers[0].watchTimeHours}
                topContent={podiumUsers[0].topContent}
                rank={1}
                className="w-44 scale-105"
              />
            )}

            {/* #3 - Right */}
            {podiumUsers[2] && (
              <UserCard
                userId={podiumUsers[2].serverUserId}
                username={podiumUsers[2].username}
                thumbUrl={podiumUsers[2].thumbUrl}
                serverId={podiumUsers[2].serverId}
                trustScore={podiumUsers[2].trustScore}
                playCount={podiumUsers[2].playCount}
                watchTimeHours={podiumUsers[2].watchTimeHours}
                topContent={podiumUsers[2].topContent}
                rank={3}
                className="w-40"
              />
            )}
          </div>

          {/* List - #4 onwards */}
          {listUsers.length > 0 && (
            <div className="space-y-2">
              {listUsers.map((user, index) => (
                <UserRow
                  key={user.serverUserId}
                  userId={user.serverUserId}
                  username={user.username}
                  thumbUrl={user.thumbUrl}
                  serverId={user.serverId}
                  trustScore={user.trustScore}
                  playCount={user.playCount}
                  watchTimeHours={user.watchTimeHours}
                  rank={index + 4}
                  style={{ animationDelay: `${index * 50}ms` }}
                />
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
