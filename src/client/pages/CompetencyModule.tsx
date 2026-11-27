import { useQuery } from '@tanstack/react-query';
import { Component, Suspense, lazy, useEffect, useState, type ReactNode } from 'react';
import { lazyRetry } from '../staleBuild';
import type { CompetencyHost } from '../competency/App';
import { installCompetencyStorage } from '../competency/storage';
import { api } from '../api';
import { useMe } from '../auth';
import { Banner, Skeleton } from '../components/ui';

// Competency (6z.34): the NESR Competency Framework System, converted to slickline, in place of the earlier
// experience page. It keeps its own screens and saves through SLK Ops (D1 and the R2 bucket); the person signed in
// to SLK Ops is its user, and their Competency rights decide whether they read or change it. Loaded only here.
// 6z.40: the same module opens as SLK Career Development (mode "career"): only the Career Development Plan, under its
// own header, on the same data and Competency users; Competency itself no longer shows the plan.

const CompetencyApp = lazy(lazyRetry(() => import('../competency/App')));

class Boundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) { return { error }; }
  render() {
    return this.state.error
      ? <Banner tone="danger">This module stopped with an error: {this.state.error.message}. Reload the page; if it happens again, tell an admin what you were doing.</Banner>
      : this.props.children;
  }
}

/** SLK Ops' theme, followed as it changes (6z.35): the switch is in the account menu, not in Competency. */
function useAppTheme(): 'light' | 'dark' {
  const read = () => (document.documentElement.dataset.theme === 'light' ? 'light' : 'dark');
  const [theme, setTheme] = useState<'light' | 'dark'>(read);
  useEffect(() => {
    const mo = new MutationObserver(() => setTheme(read()));
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    return () => mo.disconnect();
  }, []);
  return theme;
}

export function CompetencyModule({ mode = 'competency' }: { mode?: 'competency' | 'career' }) {
  const { data: me } = useMe();
  const theme = useAppTheme();
  const seed = useQuery({ queryKey: ['competency-seed'], queryFn: () => api<CompetencyHost['seed']>('/competency/slk-seed'), staleTime: Infinity });
  // Competency users and their roles are set in Users & Roles (6z.35)
  const people = useQuery({ queryKey: ['competency-users'], queryFn: () => api<{ profiles: NonNullable<CompetencyHost['people']> }>('/competency/users') });
  if (!me || seed.isPending || people.isPending) return <Skeleton className="h-96" />;
  if (seed.isError) return <Banner tone="danger">{seed.error.message}</Banner>;
  if (people.isError) return <Banner tone="danger">{people.error.message}</Banner>;
  const mine = people.data.profiles.find((p) => p.username.toLowerCase() === me.username.toLowerCase());
  installCompetencyStorage();
  const host: CompetencyHost = {
    user: me.username, name: me.fullName, admin: me.role === 'admin', canEdit: !!(mode === 'career' ? me.menus.career_development?.edit : me.menus.competency?.edit), mode,
    theme, seed: seed.data, competencyRole: mine?.role, people: people.data.profiles,
  };
  return (
    // the module brings its own header and tabs, full width under the SLK Ops bar
    <div className="-mx-4 -my-5 md:-mx-5">
      {/* the module draws its own visual header; this names the page for screen readers */}
      <h1 className="sr-only">{mode === 'career' ? 'Career Development' : 'Competency'}</h1>
      <Boundary>
        <Suspense fallback={<div className="p-5"><Skeleton className="h-96" /></div>}>
          <CompetencyApp key={mode} host={host} />
        </Suspense>
      </Boundary>
    </div>
  );
}
