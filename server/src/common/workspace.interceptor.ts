import { ForbiddenException, Injectable, type CallHandler, type ExecutionContext, type NestInterceptor } from '@nestjs/common';
import { InjectDrizzle } from '@nestjs/drizzle';
import { and, eq } from 'drizzle-orm';
import type { Observable } from 'rxjs';
import type { Db } from '../db/database.service.js';
import { userWorkspaces, workspaces } from '../db/schema.js';
import type { SafeUser } from '../auth/user.types.js';
import { workspaceContext } from './workspace-context.js';

interface RequestWithUser {
  headers: Record<string, string | string[] | undefined>;
  user?: SafeUser;
}

@Injectable()
export class WorkspaceInterceptor implements NestInterceptor {
  constructor(@InjectDrizzle() private readonly db: Db) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const request = context.switchToHttp().getRequest<RequestWithUser>();
    const user = request.user;
    if (!user) return next.handle();

    const header = request.headers['x-workspace-id'];
    const requested = (Array.isArray(header) ? header[0] : header)?.trim() ?? '';
    const available = this.available(user);
    let active = user.activeWorkspaceId || 'default';
    if (requested) {
      if (!available.includes(requested)) {
        throw new ForbiddenException('ไม่พบ Workspace หรือคุณไม่มีสิทธิ์เข้าถึง');
      }
      active = requested;
    } else if (!available.includes(active)) {
      active = available[0] ?? 'default';
    }
    user.activeWorkspaceId = active;
    return workspaceContext.run({ workspaceId: active }, () => next.handle());
  }

  private available(user: SafeUser): string[] {
    const active = this.db.select({ id: workspaces.id }).from(workspaces)
      .where(eq(workspaces.archived, false)).all().map((row) => row.id);
    if (user.isAdmin) return active;
    const member = new Set(this.db.select({ id: userWorkspaces.workspaceId }).from(userWorkspaces)
      .where(eq(userWorkspaces.userId, user.id)).all().map((row) => row.id));
    return active.filter((id) => member.has(id));
  }
}
