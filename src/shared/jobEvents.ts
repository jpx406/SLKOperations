// What the Job Log (sequence of events) says about the job's times, runs and depths (6z.49): Execution fills its
// fields from it. Each entry has a time, an optional run and depth, and what happened in words.

import { rowKind } from './jobLogForm';

export interface EventLite { occurred_at: string; run_no: number | null; depth_ft: number | null; text: string }

export interface FromLog {
  arrived_at?: string; rig_up_at?: string; rig_down_at?: string;
  runs?: number; runs_ok?: number; runs_failed?: number;
  max_depth_ft?: number; tag_depth_ft?: number;
}

const FAILED = /\bfail|\bmis-?run\b|\bunsuccess|\bnot successful\b|\baborted?\b/i;
const TAG = /\btag(ged|ging)?\b/i;

/** The times, runs and depths the log gives; a value is left out when the log does not say. */
export function fromEvents(events: EventLite[]): FromLog {
  const ev = [...events].sort((a, b) => a.occurred_at.localeCompare(b.occurred_at));
  const out: FromLog = {};
  // arrival, rig up and rig down are told apart as the job log's required lines are (6z.52: "RU" and "RD" count)
  const a = ev.find((e) => rowKind(e.text) === 'arrival'), u = ev.find((e) => rowKind(e.text) === 'rigup'), d = [...ev].reverse().find((e) => rowKind(e.text) === 'rigdown');
  if (a) out.arrived_at = a.occurred_at;
  if (u) out.rig_up_at = u.occurred_at;
  if (d) out.rig_down_at = d.occurred_at;
  const runs = new Set(ev.map((e) => e.run_no).filter((n): n is number => n != null && n > 0));
  if (runs.size) {
    const failed = new Set(ev.filter((e) => e.run_no != null && FAILED.test(e.text)).map((e) => e.run_no as number));
    out.runs = Math.max(runs.size, ...runs);
    out.runs_failed = failed.size;
    out.runs_ok = out.runs - failed.size;
  }
  const depths = ev.map((e) => e.depth_ft).filter((n): n is number => n != null && Number.isFinite(n));
  if (depths.length) out.max_depth_ft = Math.max(...depths);
  const t = [...ev].reverse().find((e) => TAG.test(e.text) && e.depth_ft != null);
  if (t) out.tag_depth_ft = t.depth_ft!;
  return out;
}
