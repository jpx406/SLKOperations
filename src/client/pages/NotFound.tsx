import { SearchX } from 'lucide-react';
import { Link } from 'react-router';
import { EmptyState, PageTitle } from '../components/ui';

/** Any address the app does not have. */
export function NotFound() {
  return (
    <section>
      <PageTitle>Page not found</PageTitle>
      <EmptyState title="This address is not a page in the app">
        <SearchX aria-hidden className="mx-auto mb-2 size-6 text-text-subtle" />
        Check the address, or <Link to="/" className="font-semibold text-accent-text underline">go to the home page</Link>.
      </EmptyState>
    </section>
  );
}
