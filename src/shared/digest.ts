// Daily reconciliation digest: what each person should look at this morning. Pure, so the preview on screen
// and the nightly email are the same text.

import { CHECKS, type CheckCode, type Severity } from './recon';

export interface DigestFinding {
  id: string; check_code: CheckCode; severity: Severity; country: string; first_seen_at: string; summary: string;
  ticket_no: string | null; unit_number: string | null; sdm_username: string | null;
}
export interface Recipient { username: string; full_name: string; role: string; countries: string[]; email: string | null }

const ORDER: Severity[] = ['high', 'medium', 'low', 'info'];
const esc = (s: unknown) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/**
 * SDMs get the findings on their own jobs plus every high one in their countries; managers and admins get
 * every high and medium one. New since yesterday is marked. Nothing to report → no email.
 */
export function buildDigest(r: Recipient, findings: DigestFinding[], appUrl: string, since: string) {
  const inScope = findings.filter((f) => r.role === 'admin' || r.countries.includes(f.country));
  const mine = r.role === 'sdm' || r.role === 'deputy_sdm'
    ? inScope.filter((f) => f.sdm_username?.toLowerCase() === r.username.toLowerCase() || f.severity === 'high')
    : inScope.filter((f) => f.severity === 'high' || f.severity === 'medium');
  if (!mine.length) return null;
  const sorted = [...mine].sort((a, b) => ORDER.indexOf(a.severity) - ORDER.indexOf(b.severity) || b.first_seen_at.localeCompare(a.first_seen_at));
  const fresh = sorted.filter((f) => f.first_seen_at >= since).length;
  const counts = ORDER.map((s) => [s, sorted.filter((f) => f.severity === s).length] as const).filter(([, n]) => n);
  const subject = `SLK Ops reconciliation: ${sorted.length} open finding${sorted.length === 1 ? '' : 's'}${fresh ? ` (${fresh} new)` : ''}`;
  const top = sorted.slice(0, 25);
  const line = (f: DigestFinding) => `${f.first_seen_at >= since ? '[new] ' : ''}${f.severity.toUpperCase()} · ${CHECKS[f.check_code]?.label ?? f.check_code}${f.ticket_no ? ` · ticket ${f.ticket_no}` : ''}${f.unit_number ? ` · ${f.unit_number}` : ''}: ${f.summary}`;
  const link = `${appUrl.replace(/\/$/, '')}/operation/reconciliation`;
  const text = [`Good morning ${r.full_name},`, '', `Open: ${counts.map(([s, n]) => `${n} ${s}`).join(', ')}.`, '', ...top.map(line),
    ...(sorted.length > top.length ? ['', `…and ${sorted.length - top.length} more.`] : []), '', `Review them: ${link}`,
    '', 'Findings close by themselves when the job or WIREGUARD is corrected; mark the rest as explained with a reason.'].join('\n');
  const html = `<div style="font-family:Arial,sans-serif;font-size:13px"><p>Good morning ${esc(r.full_name)},</p><p>Open: <b>${counts.map(([s, n]) => `${n} ${s}`).join(', ')}</b>.</p><ul>${top.map((f) => `<li>${esc(line(f))}</li>`).join('')}</ul>${sorted.length > top.length ? `<p>…and ${sorted.length - top.length} more.</p>` : ''}<p><a href="${esc(link)}">Review them in SLK Operations</a></p><p style="color:#666">Findings close by themselves when the job or WIREGUARD is corrected; mark the rest as explained with a reason.</p></div>`;
  return { subject, text, html, count: sorted.length, fresh };
}
