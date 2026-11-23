import { Injectable, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { ApiService } from './api.service';
import { MetaService } from './meta.service';
import { readActiveWorkspace, writeActiveWorkspace } from './storage';
import { ToastService } from '../shared/toast.service';

export interface WorkspaceInfo {
  id: string;
  name: string;
  archived: boolean;
}

@Injectable({ providedIn: 'root' })
export class WorkspaceSwitchService {
  private readonly api = inject(ApiService);
  private readonly meta = inject(MetaService);
  private readonly router = inject(Router);
  private readonly toast = inject(ToastService);

  readonly items = signal<WorkspaceInfo[]>([]);
  readonly active = signal<string>(readActiveWorkspace());
  readonly busy = signal(false);

  load(): void {
    this.api.get<{ items: WorkspaceInfo[]; active: string }>('/workspaces').subscribe({
      next: (result) => {
        this.items.set(result.items.filter((item) => !item.archived));
        if (result.active) {
          this.active.set(result.active);
          writeActiveWorkspace(result.active);
        }
      },
      error: () => this.items.set([]),
    });
  }

  switchTo(id: string): void {
    if (!id || id === this.active() || this.busy()) return;
    this.busy.set(true);
    this.api.post<{ active: string }>('/workspaces/active', { id }).subscribe({
      next: (result) => {
        writeActiveWorkspace(result.active);
        this.active.set(result.active);
        this.busy.set(false);
        this.meta.load(true);
        this.toast.show(`สลับไป Workspace “${this.items().find((item) => item.id === result.active)?.name ?? result.active}” แล้ว`);
        void this.router.navigateByUrl('/');
      },
      error: (error: unknown) => {
        this.busy.set(false);
        this.toast.error((error as { error?: { message?: string } })?.error?.message ?? 'สลับ Workspace ไม่สำเร็จ');
      },
    });
  }
}
