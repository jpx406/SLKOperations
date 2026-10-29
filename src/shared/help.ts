// The in-app guide (S22). Written for SLK Operations; the help assistant (S23) answers from this text only.
// Each section names the tab it belongs to, so the dialog shows only what the reader can open.

export interface HelpSection { id: string; title: string; menus: string[] | 'any'; adminOnly?: boolean; body: string }

export const HELP_SECTIONS: HelpSection[] = [
  {
    id: 'start', title: 'Signing in and moving around', menus: 'any',
    body: `Sign in with your WIREGUARD username and password; SLK Operations has no passwords of its own, so change yours in WIREGUARD (the "Change password" link in the header). You are signed out after a period without activity.

Face ID, Touch ID, a fingerprint or Windows Hello can replace the password. Set it up once on each phone or computer: sign in with your password, open the account menu (your name, top right) and choose "Set up Face ID / fingerprint & QR sign-in", then "Set up on this device". SLK Operations also offers it after a password sign-in. From then on use "Sign in with Face ID / fingerprint" on the sign-in page. On a laptop without either, choose "Sign in with your phone (QR code)", scan the code with a phone that has Face ID set up and approve there; the laptop signs in by itself. An administrator can switch Face ID off for a person in Users & Roles.

The header shows the WIREGUARD sync time (green when recent, amber after 30 minutes, red after an error), the Riyadh clock, Help, Ask (the help assistant) and your name and role. If you cover more than one country, the country switch narrows every page to one of them (on a phone it is in the account menu).

The account menu (your name, top right) holds Sunlight mode and Large touch controls. Sunlight is a high-contrast light theme for working outdoors; Large touch controls makes buttons and text bigger for fingers and gloves. Both switch on by themselves on tablets and phones; on a desk with a mouse the app opens dark and compact. Whatever you choose is remembered on that device.

The top row holds the groups (Operation, Service Quality, Attendance, Inventory and so on); the second row holds the pages in the group. You only see the tabs your role or your extra grants include.`,
  },
  {
    id: 'schedule', title: 'Schedule', menus: ['schedule'],
    body: `One row per unit, one column per day of the month. Jobs show as bars coloured by status; unit blocks (maintenance, standby, no crew) show as shaded spans. Drag a job to move it to another unit or day if you have the Schedule edit right. Canceled jobs are hidden unless you switch them on. Use "Sync from WIREGUARD" in the header to pull units, drums and runs now instead of waiting for the 15-minute sync.`,
  },
  {
    id: 'jobs', title: 'Jobs: stages, fields and locks', menus: ['jobs'],
    body: `Every job moves through Design, Preparation, Execution and Closure. Each stage shows a progress bar of the fields it still needs. Fields save as you leave them; a red mark means the value was refused and why.

Design holds the ticket, SDM, status, unit, dates, account, area, rig, well and conveyance, plus the Pre-Job Note and the services. Picking services decides which sections open later.

Preparation holds the well data, the wire and drum, the pressure control equipment, the toolstring and the crew. If the job needs a JRA (high-risk services or conditions), a banner says so and Execution stays locked until the JRA is approved.

Execution holds the times (arrival, rig-up, rig-down), NPT, runs, failure, and the sections the services opened: plug, fishing, memory survey, perforation. A job with an explosive service also shows the explosives prompt. The job log (sequence of events) records what happened in order and works offline; entries wait on the device and send when the connection is back.

Closure holds the paperwork checks (job log and ticket signed, job package, wellsite audit, runs logged in WIREGUARD), the service order, the ticket value (revenue) and the bonus distribution.

Every stage has an Attachments section at the bottom: drop photos, the signed ticket, job log scans, permits or reports there (PDF, images, Office, text, email or zip, up to 25 MB each). An uploaded JRA Excel is kept there too. Removing a file hides it; the audit trail keeps a record.

The Full Job Report prints everything on one page; the Job Package downloads a zip with the report, the job data, the sequence of events, the toolstring and the crew.`,
  },
  {
    id: 'pjn', title: 'Pre-Job Notes', menus: ['pre_job_notes'],
    body: `A Pre-Job Note tells the crew what the job is, the well data, hazards and contacts. Save keeps a draft. Confirm & send opens the email in your mail program (or downloads it as an .eml file) with the contacts filled in, and marks that version as sent. A later change makes a new version; older versions stay readable. Print gives a one-page copy for the wellsite.`,
  },
  {
    id: 'emf', title: '8 Min. Facts and the Failure Roster', menus: ['eight_min_facts', 'failure_roster'],
    body: `An 8 Min. Facts report records NPT incidents on a job: what happened, the hours lost, the severity and the actions. Save keeps a draft; Send freezes that version. A job with NPT but no report is listed on the Failure Roster summary so nothing is missed.

The Failure Roster lists failures by month with category, severity and action status. Jobs marked as failed but missing from the roster are listed too. A job can't be deleted while it has 8 Min. Facts.`,
  },
  {
    id: 'recon', title: 'Reconciliation with WIREGUARD', menus: ['reconciliation'],
    body: `Each night (and on demand) SLK Operations compares your jobs with WIREGUARD's runs: runs with no job, jobs with no runs, different dates, units, drums, wires, wells or services. Each finding has a severity. Fix the job here or the run in WIREGUARD, or explain the difference; explained findings stop showing. The morning digest emails each person the findings on their jobs. Find it under Wires → Reconciliation.`,
  },
  {
    id: 'database', title: 'Equipment database', menus: ['database'],
    body: `Units come from WIREGUARD and are read-only here. Pressure control equipment, grease panels, local lists (like plug types) and service profiles are kept here. A service profile says which domain a service belongs to and whether it is a plug, fishing, memory, perforation or explosive service; that decides which sections open on a job. Nothing that a job still uses can be removed, only switched off.`,
  },
  {
    id: 'quality', title: 'Statistics, NPT, utilization and competency', menus: ['statistics', 'npt_analysis', 'utilization', 'competency'],
    body: `Pick a period and narrow with the filter bar (year, month, account, area, domain, service, SDM, unit, conveyance). Statistics shows the job count, operating hours, NPT, fleet efficiency (op ÷ (op + NPT)), run efficiency and failures, with charts by month and dimension; click a bar to list its jobs. NPT Analysis breaks NPT down further. Utilization shows how busy each unit and person was; Competency shows who has done which services. Wire KPIs are worked out from WIREGUARD runs the same way WIREGUARD does.`,
  },
  {
    id: 'attendance', title: 'Attendance and headcount', menus: ['attendance', 'headcount_roster'],
    body: `Click a cell to set a code for that day, or switch on Multi-select, pick cells (Shift-click for a range) and set one code for all. Nothing is stored until Save. Weekends and public holidays are shaded; a red cell means the person was on leave while assigned to a job. Approving a person's month locks their row.

People come from Users & Roles: each role is assigned to a sheet under Users & Roles → Attendance categories, and one person can be moved on their Edit page, where their foreman, job title and SELF are set too. There are three sheets. Operators & Helpers: the Foreman fills the crew who report to them, the SDM approves. Support Staff (Shop): the Maintenance Supervisor fills, the Maintenance Manager approves. Management: each person fills their own row (or an Admin does), the Operations Manager approves. Someone marked SELF fills their own row on any sheet. You see the rows you fill or approve and your own. Notify emails the month's totals to everyone with the approving role in that country. The job crew pickers read the same people.`,
  },
  {
    id: 'inventory', title: 'Inventories', menus: ['inventory_explosive', 'inventory_hardware', 'inventory_mcr'],
    body: `Explosive, hardware and MCR inventories each keep a ledger: balances are the sum of movements, a movement is never edited, and a mistake is reversed with Undo. Mobilize to well sends stock against a job; Consumption & return closes it after the job. The reconciliation view lists what is still at a well. The explosive inventory is a separate tab so explosives stay with their custodian.`,
  },
  {
    id: 'wires', title: 'Wires', menus: ['wires'],
    body: `The wire register and each wire's history come from WIREGUARD (drums, runs, cuts, jarring). SLK Operations only reads them; changes are made in WIREGUARD.`,
  },
  {
    id: 'knowledge', title: 'Knowledge Hub', menus: ['knowledge_hub'],
    body: `The library of lessons learnt, best practices and learnings from incidents. Search, filter by failure type, type and category, and open an entry to read its key action or the source document. "Present these N as a toolbox talk" shows the filtered entries as full-screen slides for a crew briefing (arrow keys move, Escape leaves). The Lesson of the Week sits at the top.`,
  },
  {
    id: 'bonus', title: 'Bonus and Sales', menus: ['bonus', 'sales_dashboard'],
    body: `Bonus and revenue figures open for anyone whose access includes the Bonus or Sales tab. Bonus rules (per country, by service and role) work out each job's bonus; the distribution on the job's Closure splits it across the crew and is approved there. The Bonus report and analysis total it by person and period. The SLK Activity Dashboard totals the revenue entered on jobs by account and month and lists completed jobs missing revenue.`,
  },
  {
    id: 'ai', title: 'AI Agent and the help assistant', menus: ['ai_agent', 'ai_assistant'],
    body: `The help assistant (Ask, in the header) answers questions about how to use SLK Operations from this guide; it can't see any job data. The AI Agent (Administration → AI Agent) answers questions about your data, reading only the pages you can open with your access; revenue needs the Sales or Bonus page unlocked first. Neither can change anything. An admin sets them on or off, the model, the monthly budget and the messages per person per day.`,
  },
  {
    id: 'admin', title: 'Administration', menus: ['users'], adminOnly: true,
    body: `Users & Roles: accounts live in WIREGUARD; here you set each person's SLK Operations role and countries, switch access off, and add or remove tabs per person. The role × tab matrix sets the defaults. Admins keep every right.

Data export & import (the Data link in the header): Export downloads the whole board as a package plus a spreadsheet per table, and counts as the backup an import needs. Import takes a package, shows a dry run (new, changed, unchanged, refused) and applies only after you type IMPORT within 15 minutes of a backup. It never deletes, and history tables only take new rows.

AI Agent settings: on/off, model, the monthly budget shared with the help assistant (resets on the 1st, UTC) and the messages per person per day (resets at midnight UTC). This month's spend per person is shown below the settings.`,
  },
];

export function helpFor(menus: Record<string, { view: boolean }>, isAdmin: boolean) {
  return HELP_SECTIONS.filter((s) => (!s.adminOnly || isAdmin) && (s.menus === 'any' || s.menus.some((m) => menus[m]?.view)));
}

export function assistantPrompt(sections: HelpSection[]) {
  return `You are the help assistant inside SLK Operations, NESR's slickline operations hub. Answer questions about how to use the app, using only the guide below. You have no access to jobs, people or any other data; if asked about data, say the AI Agent (Administration → AI Agent) or the relevant page can answer it. If the guide doesn't cover something, say so and suggest asking an admin. Keep answers short and practical: the steps, then where to click.

<guide>
${sections.map((s) => `## ${s.title}\n${s.body}`).join('\n\n')}
</guide>`;
}
