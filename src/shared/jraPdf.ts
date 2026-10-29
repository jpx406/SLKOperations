// The approved JRA as a PDF, filed with the job's attachments when it is approved: the form's header, every question
// with its answer, points and what it triggered, the score and approval level, and the digital signature.

import { ANSWER_LABEL, approvalLevel, exemptions, flags, pointsFor, riskScore, type Answer, type Template } from './jra';
import { NESR_LOGO_JPEG } from './brandLogo';
import { PdfDoc } from './pdf';

const LOGO = { width: NESR_LOGO_JPEG.width, height: NESR_LOGO_JPEG.height, data: Uint8Array.from(atob(NESR_LOGO_JPEG.base64), (c) => c.charCodeAt(0)) };

export interface JraPdfInput {
  template: Template;
  answers: Record<string, Answer>;
  job: { ticket_no: string | null; well: string | null; rig: string | null; country: string; unit_number: string | null; start_date: string | null };
  details?: Record<string, unknown> | null;
  approval: { by: string; role: string; at: string; sent_by?: string | null; sent_at?: string | null };
  signature?: { fingerprint: string; sealed: boolean } | null;
}

const ACCENT: [number, number, number] = [0.78, 0.83, 0];
const GREY: [number, number, number] = [0.42, 0.42, 0.42];
const WARN: [number, number, number] = [0.72, 0.36, 0];
const BAND: [number, number, number] = [0.93, 0.94, 0.95];
const when = (iso: string) => new Date(iso).toLocaleString('en-GB', { timeZone: 'Asia/Riyadh', day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) + ' Riyadh';

export function jraPdf(p: JraPdfInput): Uint8Array {
  const { template: t, answers } = p;
  const doc = new PdfDoc();
  const m = doc.margin, right = doc.width - m, full = right - m;
  const score = riskScore(t, answers), level = approvalLevel(t, score), fl = flags(t, answers), ex = exemptions(t, answers);

  // title band
  doc.rect(m, doc.y - 46, full, 46, [18 / 255, 23 / 255, 31 / 255]);
  const lh = 34, lw = lh * (LOGO.width / LOGO.height);
  doc.jpeg(LOGO, m + 10, doc.y - 40, lw, lh);
  doc.text(m + 20 + lw, doc.y - 20, t.title ?? 'Job Risk Assessment', { size: 13, bold: true, color: [1, 1, 1] });
  doc.text(m + 20 + lw, doc.y - 36, `${t.code} Rev ${t.revision} · Ticket ${p.job.ticket_no ?? '-'} · ${p.job.country}`, { size: 9, color: [0.8, 0.8, 0.8] });
  doc.text(right - 92, doc.y - 28, 'APPROVED', { size: 14, bold: true, color: ACCENT });
  doc.y -= 60;

  // job and form header
  const d = (p.details ?? {}) as Record<string, string | undefined>;
  const facts: [string, string | null | undefined][] = [
    ['Job no.', d.job_no ?? p.job.ticket_no], ['Well', p.job.well ?? d.rig_well], ['Rig', p.job.rig], ['Unit', p.job.unit_number], ['Start', p.job.start_date],
    ['Client', d.client], ['Location', d.location], ['Performed by', d.performed_by], ['Position', d.position], ['JRA date', d.jra_date], ['The job', d.job_description],
  ];
  const shown = facts.filter(([, v]) => v);
  const colW = full / 3;
  shown.forEach(([k, v], i) => {
    const x = m + (i % 3) * colW;
    if (i % 3 === 0) { doc.need(14); doc.y -= 14; }
    doc.text(x, doc.y, `${k}: `, { size: 8.5, color: GREY });
    doc.text(x + 52, doc.y, String(v).slice(0, 48), { size: 8.5 });
  });
  doc.y -= 14;

  // score summary
  doc.need(40);
  doc.rect(m, doc.y - 34, full, 34, BAND);
  doc.text(m + 10, doc.y - 14, 'Risk index score', { size: 8, color: GREY });
  doc.text(m + 10, doc.y - 29, String(score), { size: 13, bold: true });
  doc.text(m + 130, doc.y - 14, 'Approval level', { size: 8, color: GREY });
  doc.text(m + 130, doc.y - 29, level, { size: 11, bold: true });
  doc.text(m + 330, doc.y - 14, 'MOC / exemptions', { size: 8, color: GREY });
  doc.text(m + 330, doc.y - 29, `${fl.filter((f) => f.requirement).length}${t.exemption_points ? `  (${ex} exemption${ex === 1 ? '' : 's'} x ${t.exemption_points} pts)` : ''}`, { size: 11, bold: true });
  doc.y -= 46;

  // questions by section
  const qx = m + 24, ansX = right - 150, ptsX = right - 96, qWidth = ansX - qx - 10;
  for (const [key, title] of Object.entries(t.sections)) {
    doc.need(40);
    doc.rect(m, doc.y - 18, full, 18, [0.85, 0.87, 0.89]);
    doc.text(m + 6, doc.y - 13, `${key}  ${title}`, { size: 10, bold: true });
    doc.text(ansX, doc.y - 13, 'Answer', { size: 8, bold: true });
    doc.text(ptsX, doc.y - 13, 'Points', { size: 8, bold: true });
    doc.y -= 22;
    for (const q of t.questions.filter((x) => x.section === key)) {
      const a = answers[q.id];
      const pts = pointsFor(q, a);
      const lines = Math.max(1, Math.ceil(q.text.length / 95));
      doc.need(lines * 12 + 20);
      const top = doc.y;
      doc.text(m + 4, top - 10, q.id, { size: 8.5, bold: true, color: GREY });
      doc.text(ansX, top - 10, a ? ANSWER_LABEL[a] : 'Not answered', { size: 9, bold: true, color: a ? [0, 0, 0] : WARN });
      doc.text(ptsX, top - 10, String(pts), { size: 9, bold: pts > 0, color: pts > 0 ? WARN : [0, 0, 0] });
      doc.y = top;
      doc.para(q.text, { x: qx, width: qWidth, size: 8.5 });
      const req = a && q.requirement?.when.includes(a) ? q.requirement.text : null;
      const appr = a && q.approver?.when.includes(a) ? q.approver.text : null;
      const remark = (p.details as { remarks?: Record<string, string> } | null)?.remarks?.[q.id];
      const triggers = [req, appr ? `To be approved by: ${appr}` : null].filter(Boolean).join('   ');
      if (triggers) doc.para(triggers, { x: qx, width: qWidth, size: 7.5, color: req ? WARN : GREY });
      if (remark) doc.para(`Remarks: ${remark}`, { x: qx, width: qWidth, size: 7.5, color: GREY });
      doc.y -= 3;
      doc.line(m, doc.y, right, doc.y, 0.88);
    }
    doc.y -= 8;
  }

  // notes, approval and signature
  if (t.notes?.length) {
    doc.need(30);
    doc.para('Form notes', { size: 9, bold: true, gap: 2 });
    for (const n of t.notes) doc.para(n, { size: 7.5, color: GREY });
    doc.y -= 6;
  }
  doc.need(90);
  doc.y -= 6;
  doc.rect(m, doc.y - 74, full, 74, BAND);
  const top = doc.y;
  doc.text(m + 10, top - 16, 'Approval', { size: 10, bold: true });
  doc.text(m + 10, top - 31, `Approved by ${p.approval.by} (${p.approval.role}) on ${when(p.approval.at)}`, { size: 9 });
  if (p.approval.sent_by) doc.text(m + 10, top - 44, `Sent for approval by ${p.approval.sent_by}${p.approval.sent_at ? ` on ${when(p.approval.sent_at)}` : ''}`, { size: 8.5, color: GREY });
  if (p.signature) {
    doc.text(m + 10, top - 58, `Digitally signed in SLK Operations Hub${p.signature.sealed ? ' and sealed' : ''}. Fingerprint (SHA-256 of the answers):`, { size: 7.5, color: GREY });
    doc.text(m + 10, top - 68, p.signature.fingerprint, { size: 7.5 });
  }
  doc.y = top - 84;
  return doc.bytes(`${t.code} Rev ${t.revision} · ticket ${p.job.ticket_no ?? '-'} · approved ${when(p.approval.at)} · generated by SLK Operations Hub`);
}
