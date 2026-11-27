import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { StrictMode, Suspense, lazy, type ComponentType } from 'react';
import { createRoot } from 'react-dom/client';
import { Navigate, RouterProvider, createBrowserRouter, useLocation } from 'react-router';

import { RequireAuth } from './auth';
import { AppShell } from './components/AppShell';
import { SignIn } from './pages/SignIn';
import { ModulePicker } from './pages/Modules';
import { QrApprove } from './pages/QrApprove';
import { NotFound } from './pages/NotFound';
import { RouteError } from './components/RouteError';
import { lazyRetry, watchPreloadErrors } from './staleBuild';
import './styles.css';

// a page left open across a deploy reloads into the new version instead of failing (6z.48)
watchPreloadErrors();

/**
 * A page loaded only when it is first opened (6z.70), so the first load carries the app shell, not all 40 pages.
 * Each import goes through lazyRetry: after a deploy, a page whose file was replaced reloads into the new version.
 */
function page<M>(load: () => Promise<M>, name: keyof M & string, props?: Record<string, string>) {
  return {
    lazy: lazyRetry(async () => {
      const C = (await load())[name] as unknown as ComponentType<Record<string, string>>;
      // `k` is the React key, so two routes on the same page (the three inventories) don't share state
      const Component = props ? () => { const { k, ...rest } = props; return <C key={k} {...rest} />; } : C;
      return { Component };
    }),
  };
}

// the winch analysis window (6z.41) opens on its own, without the app around it
const WinchWindow = lazy(lazyRetry(() => import('./pages/winch/WinchWindow')));


/** Sends an old address to the page's new one, keeping its filters (?severity=high ...). */
function MovedTo({ path }: { path: string }) {
  const loc = useLocation();
  return <Navigate to={`${path}${loc.search}${loc.hash}`} replace />;
}

const router = createBrowserRouter([
  { path: '/signin', element: <SignIn />, errorElement: <RouteError /> },
  // the phone side of QR sign-in: public, it signs another computer in after Face ID on this phone
  { path: '/qr/:id', element: <QrApprove /> },
  // after signing in: the SLK Operations Hub, the Knowledge Hub or Competency (6z.33)
  { path: '/modules', element: <RequireAuth><ModulePicker /></RequireAuth>, errorElement: <RouteError /> },
  { path: '/winch-window', element: <RequireAuth><Suspense fallback={null}><WinchWindow /></Suspense></RequireAuth>, errorElement: <RouteError /> },
  {
    path: '/',
    element: <RequireAuth><AppShell /></RequireAuth>,
    errorElement: <RouteError />,
    // shown while the first page's file loads
    hydrateFallbackElement: <div className="p-6 text-sm text-text-muted">Loading…</div>,
    children: [
      { index: true, element: <Navigate to="/modules" replace /> },
      { path: 'operation/schedule', ...page(() => import('./pages/Schedule'), 'Schedule') },
      { path: 'operation/jobs', ...page(() => import('./pages/JobBoard'), 'JobBoard') },
      { path: 'operation/jobs/:id/jra', ...page(() => import('./pages/Jra'), 'JraPage') },
      // the Job log and the Winch data on pages of their own, like the JRA (6z.49)
      { path: 'operation/jobs/:id/log', ...page(() => import('./pages/JobSubPages'), 'JobLogPage') },
      { path: 'operation/jobs/:id/winch', ...page(() => import('./pages/JobSubPages'), 'JobWinchPage') },
      { path: 'operation/jobs/:id/report', ...page(() => import('./pages/JobReport'), 'JobReport') },
      { path: 'operation/jobs/:id/diagrams', ...page(() => import('./pages/Diagrams'), 'Diagrams') },
      { path: 'operation/jobs/:id/:stage?', ...page(() => import('./pages/JobEditor'), 'JobEditor') },
      { path: 'operation/pre-job-notes', ...page(() => import('./pages/PreJobNotes'), 'PreJobNotesList') },
      { path: 'operation/pre-job-notes/print', ...page(() => import('./pages/PreJobNotes'), 'PreJobNotesPrint') },
      { path: 'operation/pre-job-notes/:id', ...page(() => import('./pages/PreJobNotes'), 'PreJobNoteEditor') },
      { path: 'operation/job-log', ...page(() => import('./pages/JobLog'), 'JobLog') },
      { path: 'operation/job-risk-profile', ...page(() => import('./pages/JobRiskProfile'), 'JobRiskProfile') },
      { path: 'operation/8-min-facts', ...page(() => import('./pages/EightMinFacts'), 'EightMinFactsList') },
      { path: 'operation/8-min-facts/:id', ...page(() => import('./pages/EightMinFacts'), 'EightMinFactsEditor') },
      { path: 'operation/failure-roster', ...page(() => import('./pages/FailureRoster'), 'FailureRoster') },
      { path: 'quality/statistics', ...page(() => import('./pages/Statistics'), 'Statistics') },
      { path: 'quality/npt', ...page(() => import('./pages/Statistics'), 'NptAnalysis') },
      { path: 'quality/utilization', ...page(() => import('./pages/People'), 'Utilization') },
      // the Competency Framework System, converted to slickline (6z.34)
      { path: 'competency', ...page(() => import('./pages/CompetencyModule'), 'CompetencyModule') },
      { path: 'career', ...page(() => import('./pages/CompetencyModule'), 'CompetencyModule', { mode: 'career' }) },
      // the old address, from before Competency had its own menu (6z.35)
      { path: 'quality/competency', element: <MovedTo path="/competency" /> },
      { path: 'quality/wire-kpis', ...page(() => import('./pages/Wires'), 'WireKpis') },
      { path: 'wires', ...page(() => import('./pages/Wires'), 'WiresRegister') },
      { path: 'bonus/report', ...page(() => import('./pages/Bonus'), 'BonusReport') },
      { path: 'bonus/analysis', ...page(() => import('./pages/Bonus'), 'BonusAnalysis') },
      { path: 'bonus/rules', ...page(() => import('./pages/Bonus'), 'BonusRules') },
      { path: 'sales', ...page(() => import('./pages/Sales'), 'SalesDashboard') },
      { path: 'wires/:serial', ...page(() => import('./pages/Wires'), 'WireDetail') },
      { path: 'attendance', ...page(() => import('./pages/Attendance'), 'Attendance') },
      // the Headcount Roster is now Users & Roles (people) and its Attendance categories tab
      { path: 'attendance/roster', element: <Navigate to="/admin/users" replace /> },
      { path: 'inventory/explosive', ...page(() => import('./pages/Inventory'), 'Inventory', { k: 'explosive', inv: 'explosive' }) },
      { path: 'inventory/hardware', ...page(() => import('./pages/Inventory'), 'Inventory', { k: 'hardware', inv: 'hardware' }) },
      { path: 'inventory/mcr', ...page(() => import('./pages/Inventory'), 'Inventory', { k: 'mcr', inv: 'mcr' }) },
      { path: 'wires/reconciliation', ...page(() => import('./pages/Reconciliation'), 'Reconciliation') },
      // the old address, kept for bookmarks and digest emails sent before the move
      { path: 'operation/reconciliation', element: <MovedTo path="/wires/reconciliation" /> },
      { path: 'operation/database', ...page(() => import('./pages/Database'), 'Database') },
      // Utilities (6z.47): the tools on their own, as projects
      { path: 'utilities/lessons', ...page(() => import('./pages/Lessons'), 'LessonList') },
      { path: 'utilities/lessons/:id', ...page(() => import('./pages/Lessons'), 'LessonEditor') },
      { path: 'utilities/:slug', ...page(() => import('./pages/Utilities'), 'UtilityList') },
      { path: 'utilities/:slug/:id', ...page(() => import('./pages/Utilities'), 'UtilityProject') },
      { path: 'admin/users', ...page(() => import('./pages/AdminUsers'), 'AdminUsers') },
      { path: 'admin/data', ...page(() => import('./pages/AdminData'), 'AdminData') },
      { path: 'admin/form-templates', ...page(() => import('./pages/FormTemplates'), 'FormTemplates') },
      { path: 'admin/audit', ...page(() => import('./pages/AuditTrail'), 'AuditTrail') },
      { path: 'admin/companies', ...page(() => import('./pages/AdminCompanies'), 'AdminCompanies') },
      { path: 'admin/ai-agent', ...page(() => import('./pages/AiAgent'), 'AiAgent') },
      { path: 'knowledge', ...page(() => import('./pages/Knowledge'), 'KnowledgeHub') },
      { path: 'operation/opportunities', ...page(() => import('./pages/QuickPlan'), 'QuickPlan') },
      { path: 'operation/quick-plan', element: <Navigate to="/operation/opportunities" replace /> },
      { path: '*', element: <NotFound /> },
    ],
  },
]);

// pages that refresh on a timer stop while the tab is in the background, and refresh when it comes back
const queryClient = new QueryClient({ defaultOptions: { queries: { refetchOnWindowFocus: true, refetchIntervalInBackground: false } } });

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  </StrictMode>,
);
