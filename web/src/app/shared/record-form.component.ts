import { ChangeDetectionStrategy, ChangeDetectorRef, Component, DestroyRef, EventEmitter, HostListener, Input, OnChanges, Output, SimpleChanges, inject } from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { NgTemplateOutlet } from '@angular/common';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ApiService, apiErrorMessage, apiFieldErrors } from '../core/api.service';
import { MetaService } from '../core/meta.service';
import { ToastService } from './toast.service';
import { DynamicFieldsComponent } from './fields.component';
import { ModalComponent } from './modal.component';
import type { FieldDef, RecordRow } from '../core/models';
import { PendingEditsService } from '../core/pending-edits.service';
import { displayValue } from '../core/util';

@Component({
  selector: 'app-record-form',
  standalone: true,
  imports: [ModalComponent, DynamicFieldsComponent, NgTemplateOutlet],
  template: `
    <ng-template #draftNotice>
      @if (askingDiscard) {
        <div class="notice warn" role="alert">
          มีการแก้ไขที่ยังไม่ได้บันทึก
          <button type="button" class="btn sm" (click)="askingDiscard = false">อยู่ต่อ</button>
          <button type="button" class="btn sm" (click)="discard()">ทิ้งการแก้ไข</button>
        </div>
      }
      @if (latest) {
        <div class="notice warn" role="status">
          <strong>มีการบันทึกรายการนี้จากที่อื่น</strong>
          <ul>
            @for (field of contested(); track field.key) {
              <li>{{ field.label }}: ค่าล่าสุด “{{ display(latest[field.key]) }}” · ค่าที่คุณกรอก “{{ display(values[field.key]) }}”</li>
            }
          </ul>
          <button type="button" class="btn sm" (click)="useLatest(false)">โหลดค่าล่าสุด</button>
          <button type="button" class="btn sm" (click)="useLatest(true)">เก็บร่างและแก้ก่อนลองใหม่</button>
        </div>
      }
    </ng-template>
    @if (inline) {
      <div class="card record-form-page">
        <ng-container [ngTemplateOutlet]="draftNotice" />
        @if (errorCount()) {
          <div class="notice bad" role="alert">มี {{ errorCount() }} ช่องที่ต้องแก้ไข — ตรวจสอบข้อความใต้ช่องนั้น</div>
        } @else if (message) {
          <div class="notice bad" role="alert">{{ message }}</div>
        }
        <app-fields
          [fields]="fields"
          [values]="values"
          [errors]="errors"
          [lists]="lists"
          (valuesChange)="values = $event; askingDiscard = false"
        />
        <div class="record-form-actions">
          <button type="button" class="btn" [disabled]="saving" (click)="requestClose()">ยกเลิก</button>
          <button type="button" class="btn primary" [disabled]="saving || !!latest" (click)="save()">{{ saving ? 'กำลังบันทึก…' : 'บันทึก' }}</button>
        </div>
      </div>
    } @else {
      <app-modal [title]="title || (record ? 'แก้ไข' : 'เพิ่ม') + ' ' + entityLabel" [wide]="!side" [side]="side" (closed)="requestClose()">
        <ng-container [ngTemplateOutlet]="draftNotice" />
        @if (errorCount()) {
          <div class="notice bad" role="alert">มี {{ errorCount() }} ช่องที่ต้องแก้ไข — ตรวจสอบข้อความใต้ช่องนั้น</div>
        } @else if (message) {
          <div class="notice bad" role="alert">{{ message }}</div>
        }
        <app-fields
          [fields]="fields"
          [values]="values"
          [errors]="errors"
          [lists]="lists"
          (valuesChange)="values = $event; askingDiscard = false"
        />
        <div modal-footer>
          <button type="button" class="btn" [disabled]="saving" (click)="requestClose()">ยกเลิก</button>
          <button type="button" class="btn primary" [disabled]="saving || !!latest" (click)="save()">{{ saving ? 'กำลังบันทึก…' : 'บันทึก' }}</button>
        </div>
      </app-modal>
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class RecordFormComponent implements OnChanges {
  @Input({ required: true }) entity = '';
  @Input() entityLabel = '';
  @Input({ required: true }) fields: FieldDef[] = [];
  @Input() record: RecordRow | null = null;
  @Input() title = '';
  @Input() defaults: Record<string, unknown> = {};
  @Input() inline = false;
  /** Large screens open the form as a side panel so the list stays visible; narrow screens stay full-width. */
  @Input() side = false;
  @Input() lists: { teams: string[]; depts: string[] } = { teams: [], depts: [] };
  @Input() createUrl = '';
  @Input() updateUrl = '';

  @Output() saved = new EventEmitter<RecordRow>();
  @Output() closed = new EventEmitter<void>();

  values: Record<string, unknown> = {};
  errors: Record<string, string> = {};
  message = '';
  saving = false;
  askingDiscard = false;
  latest: RecordRow | null = null;
  readonly display = displayValue;
  private baseline: Record<string, unknown> = {};
  private version?: string;
  private uncertain = false;
  private readonly destroy = inject(DestroyRef);

  constructor(
    private readonly api: ApiService,
    private readonly meta: MetaService,
    private readonly toast: ToastService,
    private readonly cdr: ChangeDetectorRef,
  ) {
    const unregister = inject(PendingEditsService).register(() => this.saving || this.dirty());
    this.destroy.onDestroy(unregister);
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['record'] || ((changes['fields'] || changes['defaults']) && !this.dirty())) {
      const source = this.record ?? { ...this.defaults };
      this.values = this.pick(source);
      this.baseline = { ...this.values };
      this.version = this.record?._updatedAt;
    }
  }

  errorCount(): number {
    return Object.keys(this.errors).length;
  }

  save(): void {
    if (this.saving || this.latest) return;
    this.saving = true;
    this.message = '';
    this.errors = {};
    const payload = this.record ? this.delta() : this.pick(this.values);
    if (this.record?.id && this.uncertain && !this.updateUrl) {
      const url = `/records/${this.entity}/${this.record.id}`;
      this.api.get<RecordRow>(url).pipe(takeUntilDestroyed(this.destroy)).subscribe({
        next: (current) => {
          this.uncertain = false;
          if (Object.entries(payload).every(([key, value]) => this.same(current[key], value))) {
            this.complete(current);
          } else if (current._updatedAt !== this.version) {
            this.saving = false;
            this.latest = current;
            this.cdr.markForCheck();
          } else {
            this.send(payload);
          }
        },
        error: (error: unknown) => this.showError(error),
      });
      return;
    }
    this.send(payload);
  }

  private send(payload: Record<string, unknown>): void {
    const request = this.record?.id
      ? this.api.patch<RecordRow>(this.updateUrl || `/records/${this.entity}/${this.record.id}`, {
          ...payload, ...(!this.updateUrl && this.version ? { _expectedUpdatedAt: this.version } : {}),
        })
      : this.api.post<RecordRow>(this.createUrl || `/records/${this.entity}`, payload);
    request.pipe(takeUntilDestroyed(this.destroy)).subscribe({
      next: (record) => this.complete(record),
      error: (error: unknown) => {
        if (this.record?.id && !this.updateUrl && error instanceof HttpErrorResponse) {
          if (error.status === 0) this.uncertain = true;
          if (error.status === 409) {
            this.api.get<RecordRow>(`/records/${this.entity}/${this.record.id}`).pipe(takeUntilDestroyed(this.destroy)).subscribe({
              next: (current) => {
                this.latest = current;
                this.saving = false;
                this.cdr.markForCheck();
              },
              error: (failure: unknown) => this.showError(failure),
            });
            return;
          }
        }
        this.showError(error);
      },
    });
  }

  private complete(record: RecordRow): void {
    this.saving = false;
    this.values = this.pick(record);
    this.baseline = { ...this.values };
    this.meta.clearOptions();
    this.toast.show(this.record ? 'บันทึกการแก้ไขแล้ว' : 'สร้างรายการแล้ว');
    this.saved.emit(record);
    this.closed.emit();
    this.cdr.markForCheck();
  }

  private showError(error: unknown): void {
    this.saving = false;
    this.errors = apiFieldErrors(error);
    this.message = this.errorCount() ? '' : apiErrorMessage(error);
    if (!this.errorCount()) this.toast.error(this.message);
    this.cdr.markForCheck();
    const first = Object.keys(this.errors)[0];
    if (first) setTimeout(() => document.getElementById('f-' + first)?.focus());
  }

  requestClose(): void {
    if (this.saving) return;
    if (this.dirty()) this.askingDiscard = true;
    else this.closed.emit();
  }

  discard(): void {
    this.values = { ...this.baseline };
    this.closed.emit();
  }

  contested(): FieldDef[] {
    const delta = this.delta();
    return this.fields.filter((field) => Object.hasOwn(delta, field.key));
  }

  useLatest(keep: boolean): void {
    if (!this.latest) return;
    const changes = keep ? this.delta() : {};
    this.version = this.latest._updatedAt;
    this.baseline = this.pick(this.latest);
    this.values = { ...this.baseline, ...changes };
    this.latest = null;
  }

  private same(left: unknown, right: unknown): boolean {
    return JSON.stringify(left ?? null) === JSON.stringify(right ?? null);
  }

  private delta(): Record<string, unknown> {
    return Object.fromEntries(Object.entries(this.pick(this.values))
      .filter(([key, value]) => !this.same(value, this.baseline[key])));
  }

  private dirty(): boolean {
    return Object.keys(this.delta()).length > 0;
  }

  @HostListener('window:beforeunload', ['$event'])
  onBeforeUnload(event: BeforeUnloadEvent): void {
    if (this.saving || this.dirty()) event.preventDefault();
  }

  private pick(source: Record<string, unknown>): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    for (const field of this.fields) {
      if (field.type === 'section' || field.type === 'formula') continue;
      if (source[field.key] !== undefined) out[field.key] = source[field.key];
    }
    return out;
  }
}
