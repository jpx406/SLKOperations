import { Construction } from 'lucide-react';
import { useLocation } from 'react-router';
import { NAV } from '../../shared/menus';
import { EmptyState, PageTitle } from '../components/ui';

/** Placeholder for screens whose milestone has not been built yet. */
export function Stub() {
  const { pathname } = useLocation();
  const page = NAV.flatMap((g) => g.pages).find((p) => pathname.startsWith(p.path));
  return (
    <section>
      <PageTitle>{page?.label ?? 'Page'}</PageTitle>
      <EmptyState title="Not built yet">
        <Construction aria-hidden className="mx-auto mb-2 size-6 text-text-subtle" />
        {page ? `Screen ${page.screen} is planned for milestone ${page.milestone}.` : 'This page is not part of the app.'}
      </EmptyState>
    </section>
  );
}
