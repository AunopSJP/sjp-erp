import type { Perms } from '../db/schema.js';

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
  perms: Perms;
  activeWorkspaceId: string;
}
