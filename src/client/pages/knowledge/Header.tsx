import { useQuery } from '@tanstack/react-query';
import { riyadhShort } from '../../../shared/dates';
import type { ReactNode } from 'react';
import type { CompetencyProfile } from '../../../shared/competencyUsers';
import { api } from '../../api';
import { useMe } from '../../auth';
import { cx } from '../../components/ui';
import type { Library } from './common';

// The SLK Knowledge Hub header (6z.35, owner request 2026-11-20), laid out like the Competency header: the Standards,
// Guidelines, Sharing, Information picture, the title, the person's segment, ID, name, role, grade and the last edit,
// and the sections as tabs along the bottom of the dark band. The band is dark in both themes, like Competency's.

// fixed colours, not theme tokens: the band stays dark in Sunlight too, so its text must stay light
const BAND = 'bg-[#1B2420] text-[#F2F5F0]';
const CELL_EDGE = 'border-[#3C4A42]';

const when = (iso: string) => riyadhShort(iso);

/** What the person is in the Knowledge Hub's document control. */
export function knowledgeRole(me: Library['me']): string {
  if (me.admin) return 'Admin';
  return [me.editor && 'Editor', me.reviewer && 'Reviewer', me.approver && 'Approver'].filter(Boolean).join(' · ') || 'Reader';
}

export function KnowledgeHeader({ lib, tabs, actions }: { lib: Library | undefined; tabs: ReactNode; actions?: ReactNode }) {
  const { data: me } = useMe();
  // the grade comes from the person's Competency profile in Users & Roles
  const profile = useQuery({ queryKey: ['competency-me'], queryFn: () => api<{ profile: CompetencyProfile | null }>('/competency/me'), staleTime: 5 * 60_000 });
  const grade = profile.data?.profile?.grade;
  const cells: [string, string, string?][] = [
    ['Segment', 'Slickline'],
    ['ID', me?.username ?? '—'],
    ['Name', me?.fullName ?? '—'],
    ['Role', lib ? knowledgeRole(lib.me) : '—'],
    ['Grade', grade ? `G${grade}` : '—', 'hidden sm:block'],
    ['Last edit', lib?.lastEdit ? `${when(lib.lastEdit.at)} · ${lib.lastEdit.by}` : '—', 'hidden md:block'],
  ];
  return (
    <header className={cx(BAND, '-mx-4 -mt-5 mb-4 px-4 pt-3 md:-mx-5 md:px-5')} aria-labelledby="kh-title">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-4">
          <img src="/brand/knowledge-hub.png" width={358} height={200} alt="" aria-hidden className="h-12 w-auto shrink-0 sm:h-[78px]" />
          <div className="min-w-0">
            <h1 id="kh-title" className="font-condensed text-[#F2F5F0] text-lg leading-tight font-bold tracking-[0.05em] uppercase sm:text-[22px]">
              SLK Knowledge <span className="text-[#8FC08A]">Hub</span>
            </h1>
            <dl className={cx('mt-1.5 flex flex-wrap overflow-hidden rounded-t border', CELL_EDGE)}>
              {cells.map(([k, v, cls]) => (
                <div key={k} className={cx('border-r bg-[#212B26] px-2.5 py-1', CELL_EDGE, cls)}>
                  <dt className="text-[9px] tracking-[0.14em] text-[#88958D] uppercase">{k}</dt>
                  <dd className="font-mono text-[11.5px] whitespace-nowrap text-[#F2F5F0]">{v}</dd>
                </div>
              ))}
            </dl>
          </div>
        </div>
        {actions && <div className="flex flex-wrap gap-1.5">{actions}</div>}
      </div>
      <nav className="flex gap-1 overflow-x-auto pt-2.5">{tabs}</nav>
    </header>
  );
}

/** A section tab on the dark band; the open one takes the page colour, as in Competency. */
export function bandTab(on: boolean) {
  return cx('font-condensed shrink-0 rounded-t-[5px] px-3 py-2 text-[13px] font-semibold tracking-[0.07em] whitespace-nowrap uppercase',
    on ? 'bg-bg text-success' : 'text-[#B9C4BC] hover:text-[#F2F5F0]');
}

/** The header's buttons, like Competency's. */
export function BandButton({ children, onClick, primary }: { children: ReactNode; onClick: () => void; primary?: boolean }) {
  return (
    <button type="button" onClick={onClick}
      className={cx('font-condensed inline-flex items-center gap-1.5 rounded-[5px] border px-3 py-1.5 text-xs font-semibold tracking-[0.08em] uppercase',
        primary ? 'border-accent bg-accent text-on-accent' : 'border-[#3C4A42] bg-[#212B26] text-[#B9C4BC] hover:text-[#F2F5F0]')}>
      {children}
    </button>
  );
}
