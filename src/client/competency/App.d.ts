// Types for the Competency module (App.jsx, the NESR Competency Framework System converted to slickline, 6z.34).
// The module itself is plain JSX; this is what SLK Ops hands it.
import type { ReactElement } from 'react';

export interface CompetencyHost {
  /** The SLK Ops username of the person signed in (their WIREGUARD employee ID). */
  user: string;
  name: string;
  /** SLK Ops admins are Super Admin in the module. */
  admin: boolean;
  /** Without the Competency edit right the person only reads. */
  canEdit: boolean;
  theme: 'light' | 'dark';
  /** competency: the Competency Framework System without the Career Development Plan; career: SLK Career Development,
   *  the plan alone under its own header (6z.40). */
  mode?: 'competency' | 'career';
  /** The person's Competency role, set in SLK Ops Users & Roles (6z.35); absent: from the SLK rights. */
  competencyRole?: string;
  /** Competency users from SLK Ops Users & Roles, copied into the employee register on load (6z.35). */
  people?: { username: string; employee_id: string | null; role: string; position: string | null; grade: number | null; segment: string; location: string | null; hire_date: string | null; mentor: string | null; status: string; name: string; email: string | null; country: string }[];
  /** What a new dataset starts from: SLK's people, services and countries. */
  seed: { employees: { id: string; name: string; country: string; crew_role: string | null; title: string; email: string | null }[]; services: [string, string][]; countries: string[] };
}

declare function App(props: { host?: CompetencyHost }): ReactElement;
export default App;

/** What Operations → Job Risk Profile reads from the module (6z.54): the risk rules, the dataset's shape and how
 *  the proficiency figures are worked out. The state and figures are the module's own untyped objects. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any;
export declare const _risk: {
  STORE_KEY: string;
  EMPTY: Any;
  LEVEL_LABEL: string[];
  L: { shift: string[] } & Record<string, Any[]>;
  ZONES: Record<string, 'BLUE' | 'GREEN' | 'YELLOW' | 'RED' | 'BLACK'>;
  ZONE_PL: Record<string, string>;
  IMPACT_ROWS: string[];
  HP_RATES: string[];
  HP_ZONES: ('G' | 'Y' | 'R')[][];
  HP_FACTORS: string[];
  HP_AUTO_COMPLEX: string[];
  HP_AUTO_SQ: string[];
  normalizeReq(s: Any): Any;
  slkSeedState(seed: CompetencyHost['seed']): Any;
  syncSlkPeople(s: Any, people: NonNullable<CompetencyHost['people']>): Any;
  deriveState(s: Any): Any;
  certsForRole(s: Any, role: string): { name: string }[];
  computeCertStatus(s: Any, empId: string, cert: Any): Any;
  certStatusCode(st: Any): number;
};
