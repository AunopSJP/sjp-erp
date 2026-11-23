import type { RecordRow } from './models';

export interface DashboardData {
  tickets: { open: number; urgent: number; mine: number };
  projects: { active: number; closed: number; byStep: Record<string, number> };
  pm: { overdue: number; week: number };
  stock: { low: number; names: string[] };
  warranty: number;
  contracts: { active: number; expiring: number; expired: number };
  pendingApprovals: number;
  finance: {
    invoices: { open: number; outstanding: number; overdue: number; overdueAmount: number; dueSoon: number };
    receipts: { count: number; month: number };
    expenses: { month: number; pending: number; pendingAmount: number };
  } | null;
  oldest: (RecordRow & { ageH: number })[];
  myTickets: RecordRow[];
  myPm: RecordRow[];
  myProjects: RecordRow[];
  byStatus: { key: string; label: string; count: number }[];
  byTeam: { label: string; count: number }[];
  byAssignee: { id: string; label: string; count: number }[];
  activity: { id: string; at: string; userName: string; action: string; summary: string }[];
}

export type WorkspaceWidgetKey =
  | 'kpi'
  | 'my-work'
  | 'approvals'
  | 'shortcuts'
  | 'queue'
  | 'activity'
  | 'finance'
  | 'status'
  | 'team'
  | 'assignee'
  | 'project-steps'
  | 'pm';

export interface WorkspaceWidgetDef {
  key: WorkspaceWidgetKey;
  title: string;
  icon: string;
  span: number;
}

export interface WorkspaceWidgetPosition {
  x: number;
  y: number;
  w: number;
  z?: number;
  /** ความสูงที่จัดไว้ (px) — ใช้เมื่อจัดเรียงอัตโนมัติ/ลากปรับแถว */
  h?: number;
}

export interface WorkspaceConfig {
  version: number;
  widgets: Partial<Record<WorkspaceWidgetKey, WorkspaceWidgetPosition>> & Record<string, WorkspaceWidgetPosition>;
  hidden: string[];
  updatedAt: string;
  activeLayerId?: string;
  layers?: WorkspaceLayer[];
}

export interface WorkspaceLayer {
  id: string;
  name: string;
  widgets: Record<string, WorkspaceWidgetPosition>;
  hidden: string[];
}
