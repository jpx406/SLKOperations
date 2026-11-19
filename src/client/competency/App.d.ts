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
  /** What a new dataset starts from: SLK's people, services and countries. */
  seed: { employees: { id: string; name: string; country: string; crew_role: string | null; title: string; email: string | null }[]; services: [string, string][]; countries: string[] };
}

declare function App(props: { host?: CompetencyHost }): ReactElement;
export default App;
