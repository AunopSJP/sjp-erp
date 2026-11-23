import { AsyncLocalStorage } from 'node:async_hooks';

interface WorkspaceContextValue {
  workspaceId: string;
}

/**
 * Model A isolation: every record query/write is scoped to the workspace of the
 * current request. Services read it through this context instead of threading a
 * parameter through every call site.
 */
export const workspaceContext = new AsyncLocalStorage<WorkspaceContextValue>();

export const currentWorkspaceId = (): string => workspaceContext.getStore()?.workspaceId ?? 'default';

export const runInWorkspace = <T>(workspaceId: string, task: () => T): T =>
  workspaceContext.run({ workspaceId }, task);
