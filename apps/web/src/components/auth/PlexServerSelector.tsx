/* eslint-disable @typescript-eslint/no-redundant-type-constituents -- eslint can't resolve @tracearr/shared types but TS compiles fine */
import { useState } from 'react';
import { Monitor, Wifi, Globe, Check, X, Loader2, ChevronDown, ChevronRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import type { PlexDiscoveredServer, PlexDiscoveredConnection } from '@tracearr/shared';
import type { PlexServerInfo, PlexServerConnection } from '@/lib/api';

/**
 * Props for PlexServerSelector component
 *
 * Two modes:
 * 1. Discovery mode (Settings): servers with tested connections, uses recommendedUri
 * 2. Signup mode (Login): servers without testing, user picks any connection
 */
export interface PlexServerSelectorProps {
  /**
   * Servers to display - can be either discovered (with testing) or basic (signup flow)
   */
  servers: PlexDiscoveredServer[] | PlexServerInfo[];

  /**
   * Called when user selects a server
   * @param serverUri - The selected connection URI
   * @param serverName - The server name
   * @param clientIdentifier - The server's unique identifier
   */
  onSelect: (serverUri: string, serverName: string, clientIdentifier: string) => void;

  /**
   * Whether a connection attempt is in progress
   */
  connecting?: boolean;

  /**
   * Name of server currently being connected to
   */
  connectingToServer?: string | null;

  /**
   * Called when user clicks cancel/back
   */
  onCancel?: () => void;

  /**
   * Show cancel button (default true)
   */
  showCancel?: boolean;

  /**
   * Additional className for the container
   */
  className?: string;
}

/**
 * Type guard to check if a server has discovery info (tested connections)
 */
function isDiscoveredServer(server: PlexDiscoveredServer | PlexServerInfo): server is PlexDiscoveredServer {
  return 'recommendedUri' in server;
}

/**
 * Type guard to check if a connection has test results
 */
function isDiscoveredConnection(conn: PlexDiscoveredConnection | PlexServerConnection): conn is PlexDiscoveredConnection {
  return 'reachable' in conn;
}

/**
 * Format latency for display
 */
function formatLatency(ms: number | null): string {
  if (ms === null) return '';
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

/**
 * PlexServerSelector - Displays Plex servers grouped by server with connection options
 *
 * Used in two contexts:
 * 1. Settings page: Shows tested connections with reachability status and auto-selects best
 * 2. Login page: Shows all connections for user selection during signup
 */
export function PlexServerSelector({
  servers,
  onSelect,
  connecting = false,
  connectingToServer = null,
  onCancel,
  showCancel = true,
  className,
}: PlexServerSelectorProps) {
  // Track which servers have expanded connection lists
  const [expandedServers, setExpandedServers] = useState<Set<string>>(new Set());

  const toggleExpanded = (clientIdentifier: string) => {
    setExpandedServers(prev => {
      const next = new Set(prev);
      if (next.has(clientIdentifier)) {
        next.delete(clientIdentifier);
      } else {
        next.add(clientIdentifier);
      }
      return next;
    });
  };

  const handleQuickConnect = (server: PlexDiscoveredServer | PlexServerInfo) => {
    // For discovered servers, use recommended URI; for basic, use first connection
    const uri = isDiscoveredServer(server)
      ? server.recommendedUri
      : server.connections[0]?.uri;

    if (!uri) return;

    onSelect(uri, server.name, server.clientIdentifier);
  };

  const handleConnectionSelect = (
    server: PlexDiscoveredServer | PlexServerInfo,
    connection: PlexDiscoveredConnection | PlexServerConnection
  ) => {
    onSelect(connection.uri, server.name, server.clientIdentifier);
  };

  if (servers.length === 0) {
    return (
      <div className={cn('text-center py-8 text-muted-foreground', className)}>
        <Monitor className="mx-auto h-12 w-12 mb-3 opacity-50" />
        <p>No Plex servers found</p>
        <p className="text-sm mt-1">Make sure you own at least one Plex server</p>
      </div>
    );
  }

  return (
    <div className={cn('space-y-3', className)}>
      {servers.map((server) => {
        const clientId = server.clientIdentifier;
        const isExpanded = expandedServers.has(clientId);
        const isDiscovered = isDiscoveredServer(server);
        const hasRecommended = isDiscovered && server.recommendedUri;
        const isConnecting = connectingToServer === server.name;

        // For discovered servers, find recommended connection
        const recommendedConn = isDiscovered
          ? server.connections.find(c => c.uri === server.recommendedUri)
          : null;

        // Count reachable connections for discovered servers
        const reachableCount = isDiscovered
          ? server.connections.filter(c => c.reachable).length
          : server.connections.length;

        return (
          <div
            key={clientId}
            className="rounded-lg border bg-card p-4"
          >
            {/* Server Header */}
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-center gap-3 min-w-0">
                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-muted">
                  <Monitor className="h-5 w-5" />
                </div>
                <div className="min-w-0">
                  <h3 className="font-medium truncate">{server.name}</h3>
                  <p className="text-xs text-muted-foreground">
                    {server.platform} • v{server.version}
                  </p>
                </div>
              </div>

              {/* Quick Connect Button */}
              {hasRecommended && (
                <Button
                  size="sm"
                  onClick={() => handleQuickConnect(server)}
                  disabled={connecting}
                >
                  {isConnecting ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin mr-1" />
                      Connecting...
                    </>
                  ) : (
                    'Connect'
                  )}
                </Button>
              )}

              {/* No recommended - need to select manually */}
              {isDiscovered && !hasRecommended && (
                <span className="text-xs text-muted-foreground">
                  No reachable connections
                </span>
              )}
            </div>

            {/* Recommended Connection Preview (for discovered servers) */}
            {recommendedConn && isDiscoveredConnection(recommendedConn) && (
              <div className="mt-3 flex items-center gap-2 text-sm">
                <Check className="h-4 w-4 text-green-500" />
                <span className="text-muted-foreground">
                  {recommendedConn.local ? 'Local' : 'Remote'}: {recommendedConn.address}:{recommendedConn.port}
                </span>
                {recommendedConn.latencyMs !== null && (
                  <span className="text-xs text-muted-foreground">
                    ({formatLatency(recommendedConn.latencyMs)})
                  </span>
                )}
              </div>
            )}

            {/* Connection Count & Expand Toggle */}
            <button
              type="button"
              onClick={() => toggleExpanded(clientId)}
              className="mt-3 flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
            >
              {isExpanded ? (
                <ChevronDown className="h-3 w-3" />
              ) : (
                <ChevronRight className="h-3 w-3" />
              )}
              {reachableCount} of {server.connections.length} connections
              {isDiscovered ? ' reachable' : ' available'}
            </button>

            {/* Expanded Connection List */}
            {isExpanded && (
              <div className="mt-3 space-y-1.5 pl-2 border-l-2 border-muted">
                {server.connections.map((conn) => {
                  const isDiscoveredConn = isDiscoveredConnection(conn);
                  const isReachable = isDiscoveredConn ? conn.reachable : true;
                  const isRecommended = isDiscovered && conn.uri === server.recommendedUri;

                  return (
                    <button
                      key={conn.uri}
                      type="button"
                      onClick={() => isReachable && handleConnectionSelect(server, conn)}
                      disabled={connecting || !isReachable}
                      className={cn(
                        'w-full flex items-center justify-between gap-2 rounded-md px-3 py-2 text-left text-sm transition-colors',
                        isReachable
                          ? 'hover:bg-muted cursor-pointer'
                          : 'opacity-50 cursor-not-allowed',
                        isRecommended && 'bg-muted/50 ring-1 ring-primary/20'
                      )}
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        {/* Reachability indicator */}
                        {isDiscoveredConn ? (
                          conn.reachable ? (
                            <Check className="h-3.5 w-3.5 flex-shrink-0 text-green-500" />
                          ) : (
                            <X className="h-3.5 w-3.5 flex-shrink-0 text-red-500" />
                          )
                        ) : conn.local ? (
                          <Wifi className="h-3.5 w-3.5 flex-shrink-0 text-green-500" />
                        ) : (
                          <Globe className="h-3.5 w-3.5 flex-shrink-0 text-blue-500" />
                        )}

                        {/* Connection details */}
                        <span className="truncate">
                          {conn.local ? 'Local' : 'Remote'}: {conn.address}:{conn.port}
                        </span>

                        {/* Recommended badge */}
                        {isRecommended && (
                          <span className="flex-shrink-0 text-xs text-primary font-medium">
                            Recommended
                          </span>
                        )}
                      </div>

                      {/* Latency */}
                      {isDiscoveredConn && conn.reachable && conn.latencyMs !== null && (
                        <span className="flex-shrink-0 text-xs text-muted-foreground">
                          {formatLatency(conn.latencyMs)}
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            )}

            {/* For non-discovered servers (signup flow), show simple connection buttons if no expand */}
            {!isDiscovered && !isExpanded && (
              <div className="mt-3 space-y-1.5">
                {server.connections.slice(0, 2).map((conn) => (
                  <Button
                    key={conn.uri}
                    variant="outline"
                    size="sm"
                    className="w-full justify-between"
                    onClick={() => handleConnectionSelect(server, conn)}
                    disabled={connecting}
                  >
                    <div className="flex items-center gap-2">
                      {conn.local ? (
                        <Wifi className="h-3 w-3 text-green-500" />
                      ) : (
                        <Globe className="h-3 w-3 text-blue-500" />
                      )}
                      <span className="text-xs">
                        {conn.local ? 'Local' : 'Remote'}: {conn.address}:{conn.port}
                      </span>
                    </div>
                    <ChevronRight className="h-4 w-4" />
                  </Button>
                ))}
                {server.connections.length > 2 && (
                  <button
                    type="button"
                    onClick={() => toggleExpanded(clientId)}
                    className="w-full text-xs text-muted-foreground hover:text-foreground py-1"
                  >
                    +{server.connections.length - 2} more connections
                  </button>
                )}
              </div>
            )}
          </div>
        );
      })}

      {/* Connecting status */}
      {connectingToServer && (
        <div className="flex items-center justify-center gap-2 py-3 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          Connecting to {connectingToServer}...
        </div>
      )}

      {/* Cancel button */}
      {showCancel && onCancel && (
        <Button
          variant="ghost"
          className="w-full"
          onClick={onCancel}
          disabled={connecting}
        >
          Cancel
        </Button>
      )}
    </div>
  );
}
