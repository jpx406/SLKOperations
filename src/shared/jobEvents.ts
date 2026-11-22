// What the Job Log (sequence of events) says about the job's times, runs and depths (6z.49): Execution fills its
// fields from it. Each entry has a time, an optional run and depth, and what happened in words.

export interface EventLite { occurred_at: string; run_no: number | null; depth_ft: number | null; text: string }

export interface FromLog {
  arrived_at?: string; rig_up_at?: string; rig_down_at?: string;
  runs?: number; runs_ok?: number; runs_failed?: number;
  max_depth_ft?: number; tag_depth_ft?: number;
}

const ARRIVED = /\barriv|\bon (site|location)\b/i;
const RIG_UP = /\brig(ged)?[\s-]*up\b|\br\/u\b/i;
const RIG_DOWN = /\brig(ged)?[\s-]*down\b|\br\/d\b/i;
const FAILED = /\bfail|\bmis-?run\b|\bunsuccess|\bnot successful\b|\baborted?\b/i;
const TAG = /\btag(ged|ging)?\b/i;

/** The times, runs and depths the log gives; a value is left out when the log does not say. */
export function fromEvents(events: EventLite[]): FromLog {
  const ev = [...events].sort((a, b) => a.occurred_at.localeCompare(b.occurred_at));
  const out: FromLog = {};
  const first = (re: RegExp) => ev.find((e) => re.test(e.text));
  const last = (re: RegExp) => [...ev].reverse().find((e) => re.test(e.text));
  const a = first(ARRIVED), u = first(RIG_UP), d = last(RIG_DOWN);
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
