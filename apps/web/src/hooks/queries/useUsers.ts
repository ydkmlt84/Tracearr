import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';

export function useUsers(params: { page?: number; pageSize?: number } = {}) {
  return useQuery({
    queryKey: ['users', 'list', params],
    queryFn: () => api.users.list(params),
    staleTime: 1000 * 60 * 5, // 5 minutes
  });
}

export function useUser(id: string) {
  return useQuery({
    queryKey: ['users', 'detail', id],
    queryFn: () => api.users.get(id),
    enabled: !!id,
    staleTime: 1000 * 60, // 1 minute
  });
}

export function useUserSessions(id: string, params: { page?: number; pageSize?: number } = {}) {
  return useQuery({
    queryKey: ['users', 'sessions', id, params],
    queryFn: () => api.users.sessions(id, params),
    enabled: !!id,
    staleTime: 1000 * 60, // 1 minute
  });
}

export function useUpdateUser() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: { trustScore?: number } }) =>
      api.users.update(id, data),
    onSuccess: (data, variables) => {
      // Update user in cache
      queryClient.setQueryData(['users', 'detail', variables.id], data);
      // Invalidate users list
      void queryClient.invalidateQueries({ queryKey: ['users', 'list'] });
    },
  });
}

export function useUserLocations(id: string) {
  return useQuery({
    queryKey: ['users', 'locations', id],
    queryFn: () => api.users.locations(id),
    enabled: !!id,
    staleTime: 1000 * 60 * 5, // 5 minutes
  });
}

export function useUserDevices(id: string) {
  return useQuery({
    queryKey: ['users', 'devices', id],
    queryFn: () => api.users.devices(id),
    enabled: !!id,
    staleTime: 1000 * 60 * 5, // 5 minutes
  });
}
