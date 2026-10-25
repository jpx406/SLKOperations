import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router';
import { api } from '../api';
import { useMe } from '../auth';
import { Banner } from './ui';

/** On the operations screens: open high-severity reconciliation findings, for people who can act on them. */
export function ReconBanner() {
  const { data: me } = useMe();
  const month = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Riyadh' }).slice(0, 7);
  const q = useQuery({
    queryKey: ['recon-summary', month], queryFn: () => api<{ open: Partial<Record<string, number>> }>(`/recon/summary?month=${month}`),
    enabled: !!me?.menus.reconciliation?.view, staleTime: 5 * 60_000,
  });
  const high = q.data?.open.high ?? 0;
  if (!high) return null;
  return (
    <div className="mb-3 print:hidden">
      <Banner tone="warning" action={<Link className="text-sm font-semibold underline" to="/operation/reconciliation?severity=high">Review</Link>}>
        {high} high-severity reconciliation finding{high === 1 ? ' is' : 's are'} open: jobs and WIREGUARD runs disagree.
      </Banner>
    </div>
  );
}
