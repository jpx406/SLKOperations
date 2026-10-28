import { useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, Plus, Search, X } from 'lucide-react';
import { useDeferredValue, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { activeFilterCount, filtersToQuery } from '../../shared/filters';
import { STAGES, stagePercent, type Stage } from '../../shared/stages';
import type { Job } from '../../shared/types';
import { ApiError, api } from '../api';
import { useMe } from '../auth';
import { FilterBar, useFilters } from '../components/FilterBar';
import { AccountLegend, useAccountColors } from '../components/Accounts';
import { NO_ACCOUNT, byAccount, tint } from '../../shared/accounts';
import { Banner, Button, EmptyState, PageTitle, Skeleton, StatusPill, cx, inputSized } from '../components/ui';
import { ReconBanner } from '../components/ReconBanner';

// Job board (S03), laid out like the WL Operations Hub: one card per job with ticket, well and dates, the SDM and
// account, the four stage bars and the status. The standard filter panel finds a job the same way as the Job Log.
// Jobs whose record isn't complete for their status say why, in words, on the card.

const STAGE_LABEL: Record<Stage, string> = { design: 'Design', preparation: 'Preparation', execution: 'Execution', closure: 'Closure' };
const STAGE_SHORT: Record<Stage, string> = { design: 'Design', preparation: 'Prep', execution: 'Execution', closure: 'Closure' };

/** Why a job needs attention, or null when its record is in order for its status. */
function attention(j: Job): string | null {
  if (j.status === 'canceled') return null;
  if (j.status === 'completed') {
    const open = STAGES.filter((s) => stagePercent(j, s) < 100).map((s) => `${STAGE_SHORT[s]} ${stagePercent(j, s)}%`);
    return open.length ? `Incomplete: ${open.join(' · ')}` : null;
  }
  const missing = [!j.unit_number && 'unit', !j.start_date && 'start date'].filter(Boolean);
  return missing.length ? `Missing ${missing.join(' and ')}` : null;
}

const accountCounts = (xs: { location: string | null }[]) => xs.reduce((m, x) => m.set(x.location?.trim() || NO_ACCOUNT, (m.get(x.location?.trim() || NO_ACCOUNT) ?? 0) + 1), new Map<string, number>());
const day = (d: string | null) => (d ? new Date(`${d}T00:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' }) : null);

export function JobBoard() {
  const [params, setParams] = useSearchParams();
  const [filters] = useFilters();
  const qText = params.get('q') ?? '';
  const onlyAttention = params.get('attention') === '1';
  const q = useDeferredValue(qText);
  const { data: me } = useMe();
  const qs = [filtersToQuery(filters), `q=${encodeURIComponent(q)}`].filter(Boolean).join('&');
  const jobs = useQuery({ queryKey: ['jobs', 'board', qs], queryFn: () => api<Job[]>(`/jobs?${qs}&status=all`), refetchInterval: 30_000 });
  const sdms = useQuery({ queryKey: ['sdms'], queryFn: () => api<{ username: string; full_name: string }[]>('/sdms'), staleTime: 300_000 });
  const name = (u: string | null) => (u ? sdms.data?.find((s) => s.username.toLowerCase() === u.toLowerCase())?.full_name ?? u : null);
  const set = (k: string, v: string) => {
    const next = new URLSearchParams(params);
    if (v) next.set(k, v); else next.delete(k);
    setParams(next, { replace: true });
  };
  const list = (jobs.data ?? []).filter((j) => !onlyAttention || attention(j));
  const flagged = (jobs.data ?? []).filter((j) => attention(j)).length;
  const filtered = activeFilterCount(filters) > 0 || !!qText;
  const colorOf = useAccountColors();

  return (
    <section aria-labelledby="board-title">
      <PageTitle aside={
        <div className="flex flex-wrap items-center gap-2">
          <label className="relative block w-72 max-w-full">
            <span className="sr-only">Search jobs</span>
            <Search aria-hidden className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-text-subtle" />
            <input className={inputSized('w-full pl-9')} placeholder="Search ticket, well, rig, SDM…" value={qText} onChange={(e) => set('q', e.target.value)} />
          </label>
          <button type="button" aria-pressed={onlyAttention} onClick={() => set('attention', onlyAttention ? '' : '1')}
            className={cx('inline-flex h-(--layout-control-md) items-center gap-1.5 rounded-md border px-3 text-sm font-semibold',
              onlyAttention ? 'border-transparent bg-warning text-on-accent' : 'border-border-strong text-warning hover:bg-surface-2')}>
            <AlertTriangle aria-hidden className="size-4" />Needs attention{jobs.data && <span className="font-mono">{flagged}</span>}
          </button>
          {me?.menus.jobs?.edit && (
            <Link to="/operation/jobs/new" className="inline-flex h-(--layout-control-md) items-center gap-1.5 rounded-md bg-accent px-4 text-sm font-bold text-on-accent hover:bg-accent-hover">
              <Plus aria-hidden className="size-4" />Create Job
            </Link>
          )}
        </div>
      }>
        <span id="board-title">Job board</span>
        {jobs.data && <span className="ml-3 align-middle font-mono text-sm font-medium normal-case text-text-muted">{list.length} jobs</span>}
      </PageTitle>
      <ReconBanner />
      <FilterBar optionsPath="/filter-options" variant="panel" />
      {jobs.data && <AccountLegend counts={accountCounts(jobs.data)} />}

      {jobs.isPending && <div className="flex flex-col gap-3">{Array.from({ length: 6 }, (_, i) => <Skeleton key={i} className="h-28" />)}</div>}
      {jobs.isError && <Banner tone="danger" action={<Button size="sm" onClick={() => jobs.refetch()}>Retry</Button>}>Couldn't load jobs. {jobs.error.message}</Banner>}
      {jobs.data && !list.length && (filtered || onlyAttention
        ? <EmptyState title="No jobs match" action={<Button onClick={() => setParams({})}>Clear filters</Button>}>Try a different ticket, well or filter.</EmptyState>
        : <EmptyState title="No jobs yet">Jobs you and your team create appear here, newest first.</EmptyState>)}

      <div className="flex flex-col gap-5">
        {byAccount(list, (j) => j.location).map((g) => (
          <section key={g.account} aria-label={`${g.account}, ${g.items.length} jobs`}>
            <h2 className="mb-2 flex items-center gap-2 font-display text-sm font-extrabold tracking-wide uppercase">
              <i aria-hidden className="inline-block size-3 rounded-full border border-black/10" style={{ backgroundColor: colorOf(g.account) }} />
              {g.account}<span className="font-mono text-xs font-medium text-text-muted">{g.items.length}</span>
            </h2>
            <ul className="flex flex-col gap-3">
              {g.items.map((j) => <JobCard key={j.id} job={j} color={colorOf(j.location)} sdm={name(j.sdm_username)} canDelete={!!me?.menus.jobs?.delete} />)}
            </ul>
          </section>
        ))}
      </div>
    </section>
  );
}

function JobCard({ job: j, sdm, canDelete, color }: { job: Job; sdm: string | null; canDelete: boolean; color?: string }) {
  const why = attention(j);
  const dates = [day(j.start_date), day(j.end_date)].filter(Boolean);
  const where = [j.location, j.field].filter(Boolean).join(' / ');
  const services = j.services?.slice(0, 2).join(', ');
  return (
    <li className="relative rounded-lg border border-l-[6px] border-card-edge bg-surface shadow-card hover:border-border-strong"
      style={color ? { backgroundColor: tint(color, 14), borderLeftColor: color } : undefined}>
      <div className="grid grid-cols-1 items-center gap-x-6 gap-y-3 p-4 pr-12 lg:grid-cols-[minmax(0,15rem)_minmax(0,1fr)_minmax(0,24rem)_auto]">
        <div className="min-w-0">
          <Link to={`/operation/jobs/${j.id}/design`} className="block truncate font-display text-xl font-extrabold text-accent-text uppercase after:absolute after:inset-0 after:content-['']">
            {j.ticket_no ?? 'No ticket'}
          </Link>
          <p className="truncate text-sm text-text-muted">{j.well ?? 'Well —'} · {j.rig ?? 'Rig —'}</p>
          <p className="font-mono text-xs text-text-subtle">{dates.length ? dates.join(' – ') : 'no start'}</p>
        </div>
        <div className="min-w-0 text-sm">
          <p className="truncate">{sdm ? <>SDM: {sdm}</> : <span className="text-text-muted">SDM unassigned</span>}</p>
          <p className="truncate text-text-muted">{where || '— / —'}{services ? ` · ${services}` : ''}{j.unit_number ? ` · Unit ${j.unit_number}` : ''}</p>
          {why && <p className="mt-1 flex items-center gap-1 text-xs font-semibold text-warning"><AlertTriangle aria-hidden className="size-3.5" />{why}</p>}
        </div>
        <div className="grid grid-cols-4 gap-3" role="img" aria-label={STAGES.map((s) => `${STAGE_LABEL[s]} ${stagePercent(j, s)} percent`).join(', ')}>
          {STAGES.map((s) => {
            const v = stagePercent(j, s);
            return (
              <div key={s} aria-hidden>
                <p className="label-caps mb-1.5 flex justify-between text-info"><span>{STAGE_LABEL[s]}</span></p>
                <div className="h-1.5 overflow-hidden rounded-pill bg-surface-3">
                  <div className={cx('h-full rounded-pill', v >= 100 ? 'bg-success' : 'bg-accent')} style={{ width: `${Math.min(100, v)}%` }} />
                </div>
              </div>
            );
          })}
        </div>
        <div className="flex items-center gap-3 lg:justify-end">
          {j.job_efficiency_pct != null && <span className="font-mono text-sm whitespace-nowrap text-text-muted">{j.job_efficiency_pct}% eff</span>}
          <StatusPill status={j.status} />
        </div>
      </div>
      {canDelete && <DeleteButton job={j} />}
    </li>
  );
}

/** The X on a card: asks once, then deletes. The API refuses jobs with a Pre-Job Note or 8 Min. Facts and says why. */
function DeleteButton({ job }: { job: Job }) {
  const qc = useQueryClient();
  const [step, setStep] = useState<'idle' | 'confirm' | 'busy'>('idle');
  const [error, setError] = useState<string | null>(null);
  const remove = async () => {
    setStep('busy');
    try { await api(`/jobs/${job.id}`, { method: 'DELETE' }); await qc.invalidateQueries({ queryKey: ['jobs'] }); }
    catch (e) { setError((e as ApiError).message); setStep('idle'); }
  };
  return (
    <div className="absolute top-3 right-3 z-[1] flex max-w-md flex-wrap items-center justify-end gap-2">
      {error && <span role="alert" className="rounded-md bg-surface px-2 text-xs text-danger">{error}</span>}
      {step === 'idle'
        ? <Button size="sm" variant="ghost" aria-label={`Delete job ${job.ticket_no ?? 'without ticket'}`} onClick={() => { setError(null); setStep('confirm'); }}><X aria-hidden className="size-4" /></Button>
        : <span className="flex items-center gap-1.5 rounded-md bg-surface p-1 shadow-pop">
            <Button size="sm" variant="danger" loading={step === 'busy'} onClick={remove}>Delete {job.ticket_no ?? 'this job'}</Button>
            <Button size="sm" variant="ghost" onClick={() => setStep('idle')}>Keep</Button>
          </span>}
    </div>
  );
}
