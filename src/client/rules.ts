import { useQuery } from '@tanstack/react-query';
import type { RuleDef, Rules } from '../shared/approvalRules';
import { setRoleLabels } from '../shared/roles';
import { api } from './api';

// Roles and approval rules from the server (Users & Roles → Roles and → Approvals), shared by every screen.

export interface RoleRow { key: string; label: string; description: string | null; from_wireguard: number; builtin: number; users: number; active_users: number }

/** The roles; also teaches roleLabel() the names of added or renamed roles. */
export function useRoles() {
  return useQuery({
    queryKey: ['roles'],
    queryFn: async () => { const list = await api<RoleRow[]>('/roles'); setRoleLabels(list); return list; },
    staleTime: 60_000,
  });
}

export function useRules() {
  return useQuery({ queryKey: ['rules'], queryFn: () => api<{ rules: Rules; defs: (RuleDef & { changed: boolean; updated_by: string | null; updated_at: string | null })[] }>('/rules'), staleTime: 60_000 });
}
