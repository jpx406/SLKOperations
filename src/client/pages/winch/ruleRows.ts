import { fmt } from '../../../shared/winchData';
import { BRAIDED_CHECKS, BRAIDED_LABEL, braidedText, type LineKind } from '../../../shared/winchGuide';
import { SOP_LABEL, SOP_SOURCE, jarUpLimit, type Restriction, type SopRuleKey } from '../../../shared/winchRuns';
import type { RunReport } from './Report';

// What each winch rule asks for, in words, and how often a run broke it (6z.47): the SOP-04 tab, the printed
// "Result by rule" table and the main issue of a run all read it from here.

export const SPEED_RULES: SopRuleKey[] = ['surfaceSpeed', 'restrictionSpeed', 'maxRih', 'maxPooh', 'rihTension', 'poohTension'];
export const JAR_RULES: SopRuleKey[] = ['jarMat', 'jarSpang', 'jarHeavy', 'jarDown', 'jarCycle', 'jarRest', 'jarCycles'];

/** The requirement of each speed, tension and jarring rule for this run. */
export function sopTexts(r: RunReport, restrictions: Restriction[]): Record<SopRuleKey, string> {
  const sop = r.sop;
  const lim = jarUpLimit(sop);
  const svc = r.isDefault ? `the default speeds${r.service ? ` (${r.service} is not listed)` : ''}` : `${r.group}`;
  return {
    surfaceSpeed: `${sop.surfaceSpeed} ft/min or less while the tools are shallower than ${sop.surfaceDepth} ft`,
    restrictionSpeed: restrictions.length ? `${sop.restrictionSpeed} ft/min or less from ${sop.restrictionBand} ft before to ${sop.restrictionBand} ft past ${restrictions.map((x) => `${x.label} (${fmt(x.depth)} ft)`).join(', ')}` : 'No restrictions entered for this well',
    maxRih: `${sop.maxRih} ft/min or less running in: ${svc}`,
    maxPooh: `${sop.maxPooh} ft/min or less pulling out: ${svc}`,
    rihTension: sop.rihFactor ? `Running in, the normal tension stays over ${sop.rihFactor} × the static tension at that depth` : 'Not checked',
    poohTension: sop.poohFactor ? `Pulling out, the normal tension stays under ${sop.poohFactor} × the static tension at that depth` : 'Not checked',
    jarMat: lim ? `Jarring up never over ${fmt(lim.limit)} lbs (the ${lim.from})` : 'Not checked: enter the wire breaking strength or the MAT',
    jarSpang: sop.spang ? `Jarring up never over the spang jar limit of ${fmt(sop.spangLimit)} lbs` : 'Not checked: no spang jars in the string',
    jarHeavy: sop.heavyLb ? `Jarring over ${fmt(sop.heavyLb)} lbs is heavy jarring: it needs a new program and an MoC approved by the NESR OM` : 'Not checked',
    jarDown: `Jarring down never loses more than ${sop.jarDownLossPct}% of the normal tension`,
    jarCycle: `A jarring cycle lasts ${sop.cycleMin} minutes or less`,
    jarRest: `At least ${sop.restMin} minutes of rest between cycles`,
    jarCycles: `After ${sop.maxCycles} cycles at one place: pull out, cut 1.5 × the distance from the hay pulley to the stuffing box, new rope socket`,
  };
}

export interface RuleRow { label: string; source: string; requirement: string; count: number; off: boolean }

/** Every rule the run was checked against, with its requirement and how many flags it raised. */
export function ruleRows(r: RunReport, kind: LineKind, restrictions: Restriction[]): RuleRow[] {
  const t = sopTexts(r, restrictions);
  const flags = [...r.speed, ...r.jar.findings];
  const sop = (k: SopRuleKey): RuleRow => ({ label: SOP_LABEL[k], source: SOP_SOURCE[k], requirement: t[k], count: flags.filter((f) => f.rule === k).length, off: /^(Not checked|No restrictions)/.test(t[k]) });
  const season = BRAIDED_CHECKS.map((k): RuleRow => ({ label: BRAIDED_LABEL[k] ?? k, source: 'Seasoning rules', requirement: braidedText(r.a.R, k), count: r.a.viol.filter((v) => v.rule === k).length, off: false }));
  return kind === 'wire' ? [...SPEED_RULES.map(sop), ...JAR_RULES.map(sop)] : [...season, sop('restrictionSpeed'), ...JAR_RULES.map(sop)];
}

/** The rule a run broke most, "Label (n)", or null when nothing broke. */
export function mainIssue(rows: RuleRow[]): string | null {
  const top = [...rows].sort((a, b) => b.count - a.count)[0];
  return top && top.count ? `${top.label} (${top.count})` : null;
}
