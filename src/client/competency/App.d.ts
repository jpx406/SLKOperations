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
  /** The person's Competency role, set in SLK Ops Users & Roles (6z.35); absent: from the SLK rights. */
  competencyRole?: string;
  /** Competency users from SLK Ops Users & Roles, copied into the employee register on load (6z.35). */
  people?: { username: string; employee_id: string | null; role: string; position: string | null; grade: number | null; segment: string; location: string | null; hire_date: string | null; mentor: string | null; status: string; name: string; email: string | null; country: string }[];
  /** What a new dataset starts from: SLK's people, services and countries. */
  seed: { employees: { id: string; name: string; country: string; crew_role: string | null; title: string; email: string | null }[]; services: [string, string][]; countries: string[] };
}

declare function App(props: { host?: CompetencyHost }): ReactElement;
export default App;
