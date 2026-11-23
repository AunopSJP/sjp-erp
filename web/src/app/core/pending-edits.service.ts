import { Injectable, inject } from '@angular/core';
import type { CanDeactivateFn } from '@angular/router';

@Injectable({ providedIn: 'root' })
export class PendingEditsService {
  private readonly editors = new Set<() => boolean>();

  register(pending: () => boolean): () => void {
    this.editors.add(pending);
    return () => { this.editors.delete(pending); };
  }

  hasPending(): boolean {
    return [...this.editors].some((pending) => pending());
  }
}

export const leaveWithPendingEdits: CanDeactivateFn<unknown> = () =>
  !inject(PendingEditsService).hasPending() || window.confirm('มีการแก้ไขที่ยังไม่บันทึก ต้องการทิ้งและออกจากหน้านี้หรือไม่?');
