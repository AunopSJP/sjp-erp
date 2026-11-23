import { Injectable, inject } from '@angular/core';
import type { Observable } from 'rxjs';
import { ApiService } from './api.service';

export type ViewVisibility = 'private' | 'team';

export interface SavedViewConfig {
  q?: string;
  fv?: Record<string, string>;
  tab?: string;
  sort?: { key: string; dir: 1 | -1 };
  hiddenColumns?: string[];
  pageSize?: number;
  where?: string;
  groupBy?: string[];
}

export interface SavedViewRow {
  id: string;
  entity: string;
  name: string;
  visibility: ViewVisibility;
  ownerId: string;
  ownerName: string;
  config: SavedViewConfig;
  mine: boolean;
  createdAt: string;
  updatedAt: string;
}

@Injectable({ providedIn: 'root' })
export class SavedViewsService {
  private readonly api = inject(ApiService);

  load(entity: string): Observable<{ items: SavedViewRow[] }> {
    return this.api.get<{ items: SavedViewRow[] }>('/views', { entity });
  }

  create(entity: string, name: string, visibility: ViewVisibility, config: SavedViewConfig): Observable<SavedViewRow> {
    return this.api.post<SavedViewRow>('/views', { entity, name, visibility, config });
  }

  update(id: string, patch: { name?: string; visibility?: ViewVisibility; config?: SavedViewConfig }): Observable<SavedViewRow> {
    return this.api.put<SavedViewRow>(`/views/${encodeURIComponent(id)}`, patch);
  }

  remove(id: string): Observable<{ ok: true }> {
    return this.api.delete<{ ok: true }>(`/views/${encodeURIComponent(id)}`);
  }
}
