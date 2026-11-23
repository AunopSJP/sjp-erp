export interface SafeUser {
  id: string;
  username: string;
  name: string;
  roleId: string;
  roleName: string;
  dept: string;
  team: string;
  projectIds: string[];
  siteIds: string[];
  active: boolean;
  isAdmin: boolean;
  scope: string;
  perms: Record<string, Record<string, boolean>>;
}

export type FieldType =
  | 'text'
  | 'textarea'
  | 'number'
  | 'date'
  | 'datetime'
  | 'select'
  | 'multiselect'
  | 'boolean'
  | 'ref'
  | 'file'
  | 'rows'
  | 'formula'
  | 'section'
  | 'email'
  | 'phone'
  | 'url';

export interface RowColumn {
  key: string;
  label: string;
  type: FieldType;
  ref?: string;
  options?: string[];
  required?: boolean;
}

export interface FieldDef {
  key: string;
  label: string;
  type: FieldType;
  required?: boolean;
  unique?: boolean;
  options?: string[];
  optionMeta?: OptionDef[];
  optionsFrom?: string;
  ref?: string;
  multiple?: boolean;
  displayField?: string;
  cols?: RowColumn[];
  hidden?: boolean;
  showIf?: { field: string; value: unknown };
  suffix?: string;
  decimals?: number;
  min?: number;
  max?: number;
  currency?: string;
  maxLength?: number;
  help?: string;
  wide?: boolean;
  readOnly?: boolean;
  sensitive?: boolean;
  formula?: string;
  archived?: boolean;
  mirror?: { entity: string; field: string };
  optionFilter?: { by: string; targetField: string };
}

export type OptionColor = 'gray' | 'red' | 'amber' | 'green' | 'blue';

export interface OptionDef {
  id: string;
  label: string;
  color?: OptionColor;
  archived?: boolean;
  roles?: string[];
}

export interface EntityDef {
  key: string;
  label: string;
  resource: string;
  prefix: string;
  title: string;
  cols: string[];
  filters: string[];
  fields: FieldDef[];
  scoped?: boolean;
  system?: boolean;
  custom?: boolean;
  status?: 'draft' | 'published' | 'archived';
  group?: string;
  navLabel?: string;
  icon?: string;
  description?: string;
  aliases?: string[];
  workflowKey?: string;
  can?: Record<string, boolean>;
}

export interface WorkflowStatus {
  key: string;
  label: string;
  color: string;
  next: string[];
  requiredFields: string[];
  final?: boolean;
  needClosePerm?: boolean;
  enabled: boolean;
  approverRole?: string;
  approverUser?: string;
}

export interface ApprovalRow {
  id: string;
  at: string;
  by: string;
  byName: string;
  status: 'pending' | 'approved' | 'rejected' | string;
  entity: string;
  recordId: string;
  kind: 'transition' | 'po-status' | 'project-step' | string;
  key: string;
  title: string;
  payload: Record<string, unknown>;
  cfg: { approverRole?: string; approverUser?: string };
  decidedBy?: string | null;
  decidedAt?: string | null;
  note: string;
  decidedByName: string;
  approverRoleName: string;
  approverUserName: string;
  canDecide: boolean;
}

export interface StepDoc {
  key: string;
  label: string;
  required?: boolean;
  signoff?: boolean;
}

export interface ProjectStepDef {
  key: string;
  label: string;
  desc: string;
  fields: FieldDef[];
  docs: StepDoc[];
  enabled: boolean;
  requireDocs: boolean;
  approvalRequired: boolean;
  approverRole?: string;
  approverUser?: string;
  source?: string;
  tracks?: string[];
}

export interface WorkflowDef {
  confirmed?: boolean;
  statuses?: WorkflowStatus[];
  steps?: ProjectStepDef[];
  limits?: unknown[];
}

export interface MetaResponse {
  entities: Record<string, EntityDef>;
  workflows: Record<string, WorkflowDef> & {
    ticket: WorkflowDef & { confirmed: boolean; statuses: WorkflowStatus[] };
    po: WorkflowDef & { confirmed: boolean; statuses: WorkflowStatus[]; limits: unknown[] };
    project: WorkflowDef & { confirmed: boolean; steps: ProjectStepDef[] };
  };
  lists: { teams: string[]; depts: string[] };
  resources: Record<string, string>;
  customModules?: EntityDef[];
  nav: [string, [string, string][]][];
}

export interface RecordRow {
  id: string;
  code: string;
  _labels?: Record<string, string>;
  _rowLabels?: Record<string, Array<Record<string, string>>>;
  _createdAt?: string;
  _updatedAt?: string;
  _createdBy?: string;
  _updatedBy?: string;
  _createdByName?: string;
  _updatedByName?: string;
  _deleted?: boolean;
  _deleteReason?: string;
  [key: string]: unknown;
}

export interface ListResponse<T = RecordRow> {
  total: number;
  page: number;
  pageSize: number;
  items: T[];
}

export interface Option {
  value: string;
  label: string;
  color?: OptionColor;
  archived?: boolean;
}

export interface AuthResult {
  token: string;
  user: SafeUser;
}

export interface RoleRow {
  id: string;
  name: string;
  isAdmin: boolean;
  scope: string;
  perms: Record<string, Record<string, boolean>>;
}

export interface UploadedFile {
  id: string;
  name: string;
  mime: string;
  size: number;
  url: string;
  createdAt: string;
}
