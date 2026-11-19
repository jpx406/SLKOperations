import { useQuery } from '@tanstack/react-query';
import { Component, Suspense, lazy, type ReactNode } from 'react';
import type { CompetencyHost } from '../competency/App';
import { installCompetencyStorage } from '../competency/storage';
import { api } from '../api';
import { useMe } from '../auth';
import { Banner, Skeleton } from '../components/ui';

// Competency (6z.34): the NESR Competency Framework System, converted to slickline, in place of the earlier
// experience page. It keeps its own screens and saves through SLK Ops (D1 and the R2 bucket); the person signed in
// to SLK Ops is its user, and their Competency rights decide whether they read or change it. Loaded only here.

const CompetencyApp = lazy(() => import('../competency/App'));

class Boundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) { return { error }; }
  render() {
    return this.state.error
      ? <Banner tone="danger">Competency stopped with an error: {this.state.error.message}. Reload the page; if it happens again, tell an admin what you were doing.</Banner>
      : this.props.children;
  }
}

export function CompetencyModule() {
  const { data: me } = useMe();
  const seed = useQuery({ queryKey: ['competency-seed'], queryFn: () => api<CompetencyHost['seed']>('/competency/slk-seed'), staleTime: Infinity });
  if (!me || seed.isPending) return <Skeleton className="h-96" />;
  if (seed.isError) return <Banner tone="danger">{seed.error.message}</Banner>;
  installCompetencyStorage();
  const host: CompetencyHost = {
    user: me.username, name: me.fullName, admin: me.role === 'admin', canEdit: !!me.menus.competency?.edit,
    theme: document.documentElement.dataset.theme === 'light' ? 'light' : 'dark', seed: seed.data,
  };
  return (
    // the module brings its own header and tabs, full width under the SLK Ops bar
    <div className="-mx-4 -my-5 md:-mx-5">
      <Boundary>
        <Suspense fallback={<div className="p-5"><Skeleton className="h-96" /></div>}>
          <CompetencyApp host={host} />
        </Suspense>
      </Boundary>
    </div>
  );
}
