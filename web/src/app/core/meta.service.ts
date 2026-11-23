import { Injectable, signal } from '@angular/core';
import { Observable, of, shareReplay, tap } from 'rxjs';
import { ApiService } from './api.service';
import type { EntityDef, MetaResponse, Option, ProjectStepDef, WorkflowStatus } from './models';

@Injectable({ providedIn: 'root' })
export class MetaService {
  readonly meta = signal<MetaResponse | null>(null);
  readonly loading = signal(false);
  private readonly optionCache = new Map<string, Option[]>();
  readonly failed = signal(false);
  private request$: Observable<MetaResponse> | null = null;

  constructor(private readonly api: ApiService) {}

  /** Loads metadata once and lets guards await it before activation. */
  ensureLoaded(force = false): Observable<MetaResponse> {
    const current = this.meta();
    if (!force && current) return of(current);
    if (!this.request$) {
      this.loading.set(true);
      this.failed.set(false);
      this.request$ = this.api.get<MetaResponse>('/meta').pipe(
        tap({
          next: (meta) => {
            this.meta.set(meta);
            this.loading.set(false);
            this.request$ = null;
          },
          error: () => {
            this.loading.set(false);
            this.failed.set(true);
            this.request$ = null;
          },
        }),
        shareReplay(1),
      );
    }
    return this.request$;
  }

  load(force = false): void {
    this.ensureLoaded(force).subscribe({ error: () => undefined });
  }

  entity(key: string): EntityDef | undefined {
    return this.meta()?.entities[key];
  }

  ticketWorkflow(): WorkflowStatus[] {
    return this.meta()?.workflows.ticket.statuses ?? [];
  }

  poWorkflow(): WorkflowStatus[] {
    return this.meta()?.workflows.po.statuses ?? [];
  }

  workflowFor(entity: EntityDef | string): WorkflowStatus[] {
    const def = typeof entity === 'string' ? this.entity(entity) : entity;
    const key = def?.workflowKey ?? (typeof entity === 'string' ? entity : entity.key);
    const workflows = this.meta()?.workflows;
    const workflow = workflows?.[key];
    return workflow?.statuses ?? [];
  }

  projectSteps(): ProjectStepDef[] {
    return this.meta()?.workflows.project.steps ?? [];
  }

  lists(): { teams: string[]; depts: string[] } {
    return this.meta()?.lists ?? { teams: [], depts: [] };
  }

  options(entity: string, filter?: { field: string; value: string }): Observable<Option[]> {
    const key = filter?.value ? `${entity}|${filter.field}|${filter.value}` : entity;
    const cached = this.optionCache.get(key);
    if (cached) return of(cached);
    const params = filter?.value ? { filterField: filter.field, filterValue: filter.value } : undefined;
    return this.api.get<Option[]>(`/meta/options/${entity}`, params).pipe(
      tap((options) => this.optionCache.set(key, options)),
    );
  }

  clearOptions(): void {
    this.optionCache.clear();
  }
}
