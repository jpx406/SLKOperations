import { Component, Suspense, lazy, type ReactNode } from 'react';
import { lazyRetry } from '../staleBuild';
import { Banner, PageTitle, Skeleton } from '../components/ui';

// Operations → Job Risk Profile (6z.54): the Risk Tool and Crew Check that were the Tools tab of the Competency
// Framework, in SLK Ops' own look. The rules and the proficiency figures still come from the Competency module, so
// the tool is loaded only when this page opens.

const JobRiskTool = lazy(lazyRetry(() => import('./JobRiskTool')));

class Boundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) { return { error }; }
  render() {
    return this.state.error ? <Banner tone="danger">This page stopped with an error: {this.state.error.message}. Reload the page; if it happens again, tell an admin.</Banner> : this.props.children;
  }
}

export function JobRiskProfile() {
  return (
    <section aria-labelledby="jrp-title">
      <PageTitle><span id="jrp-title">Job Risk Profile</span></PageTitle>
      <p className="-mt-3 mb-4 max-w-3xl text-sm text-text-muted">
        How high-profile and complex a job is, the proficiency it needs, who can be assigned, and whether a crew is compliant. Levels and certifications come from the Competency Framework.
      </p>
      <Boundary>
        <Suspense fallback={<Skeleton className="h-96" />}><JobRiskTool /></Suspense>
      </Boundary>
    </section>
  );
}
