import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, type ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router';
import type { Me } from '../shared/types';
import { ApiError, api } from './api';
import { Skeleton } from './components/ui';

/** The signed-in user, or null when signed out. */
export function useSession() {
  return useQuery<Me | null, ApiError>({
    queryKey: ['session'],
    queryFn: async () => (await api<{ user: Me | null }>('/session')).user,
    staleTime: 60_000,
    retry: (n, e) => e.status === 503 && n < 2,
  });
}

/** For screens inside RequireAuth, where the user is known to be signed in. */
export function useMe() {
  const s = useSession();
  return { ...s, data: s.data ?? undefined };
}

export function RequireAuth({ children }: { children: ReactNode }) {
  const session = useSession();
  const qc = useQueryClient();
  const loc = useLocation();

  useEffect(() => {
    // any API call answering 401 means the session ended: re-check, which sends the user to sign-in
    const onOut = () => qc.invalidateQueries({ queryKey: ['session'] });
    window.addEventListener('slk:signed-out', onOut);
    return () => window.removeEventListener('slk:signed-out', onOut);
  }, [qc]);

  if (session.isPending) {
    return (
      <div className="p-6" aria-busy="true" aria-label="Loading">
        <Skeleton className="mb-4 h-16" />
        <Skeleton className="h-96" />
      </div>
    );
  }
  if (session.isError) {
    return (
      <div role="alert" className="m-6 rounded-md border-l-3 border-danger bg-danger-subtle p-4 text-danger">
        {session.error.message}
      </div>
    );
  }
  if (!session.data) return <Navigate to={`/signin?next=${encodeURIComponent(loc.pathname + loc.search)}`} replace />;
  return <>{children}</>;
}
