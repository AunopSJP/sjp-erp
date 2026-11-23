import { ChangeDetectionStrategy, Component, DestroyRef, ElementRef, OnInit, computed, inject, input, output, signal, viewChild } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ApiService, apiErrorMessage } from '../core/api.service';
import type { EntityDef, FieldDef } from '../core/models';
import { MetaService } from '../core/meta.service';
import { ToastService } from './toast.service';
import { ModalComponent } from './modal.component';

export interface CreatedField {
  entity: string;
  field: FieldDef;
  backlink?: { entity: string; key: string; label: string };
  showInView: boolean;
}

export interface OptionRow {
  id: string;
  label: string;
  color: 'gray' | 'red' | 'amber' | 'green' | 'blue';
  archived: boolean;
  roles: string[];
}

const OPTION_COLORS: [OptionRow['color'], string][] = [
  ['gray', 'เทา'], ['blue', 'น้ำเงิน'], ['green', 'เขียว'], ['amber', 'เหลือง'], ['red', 'แดง'],
];

type DrawerType = 'text' | 'textarea' | 'number' | 'date' | 'datetime' | 'boolean' | 'select' | 'multiselect' | 'ref';

const TYPE_OPTIONS: [DrawerType, string][] = [
  ['text', 'ข้อความสั้น'],
  ['textarea', 'ข้อความยาว'],
  ['number', 'จำนวน / เงิน'],
  ['date', 'วันที่'],
  ['datetime', 'วันเวลา'],
  ['boolean', 'ใช่ / ไม่ใช่'],
  ['select', 'เลือกหนึ่งค่า'],
  ['multiselect', 'เลือกหลายค่า'],
  ['ref', 'Relation (อ้างอิงรายการอื่น)'],
];

@Component({
  selector: 'app-schema-drawer',
  imports: [ModalComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './schema-drawer.component.html',
  styleUrl: './schema-drawer.component.css',
})
export class SchemaDrawerComponent implements OnInit {
  readonly entity = input.required<EntityDef>();
  readonly created = output<CreatedField>();
  readonly closed = output<void>();

  readonly types = TYPE_OPTIONS;
  readonly colors = OPTION_COLORS;
  readonly label = signal('');
  readonly key = signal('');
  readonly type = signal<DrawerType>('text');
  readonly optionRows = signal<OptionRow[]>([]);
  readonly required = signal(false);
  readonly help = signal('');
  readonly wide = signal(false);
  readonly decimals = signal('');
  readonly min = signal('');
  readonly max = signal('');
  readonly currency = signal('');
  readonly maxLength = signal('');
  readonly reviewing = signal(false);
  readonly refTarget = signal('');
  readonly multiple = signal(false);
  readonly displayField = signal('');
  readonly backlink = signal(false);
  readonly backlinkKey = signal('');
  readonly backlinkLabel = signal('');
  readonly showInView = signal(true);
  readonly impact = signal<{
    affected: number;
    total: number;
    views: { id: string; name: string; visibility: string }[];
    workflows: string[];
  } | null>(null);
  readonly impactBusy = signal(false);
  readonly backlinkMultiple = signal(false);
  readonly fieldTypeDraft = signal<Record<string, string>>({});
  readonly fieldActionBusy = signal('');
  readonly pendingConvert = signal<{ key: string; type: string } | null>(null);
  readonly roles = signal<{ id: string; name: string }[]>([]);
  readonly editOptionsKey = signal('');
  readonly editOptionRows = signal<OptionRow[]>([]);
  readonly editOptionsBusy = signal(false);
  readonly busy = signal(false);
  readonly error = signal('');
  readonly fieldErrors = signal<Record<string, string>>({});
  readonly askingDiscard = signal(false);
  private keyEdited = false;
  private readonly labelInput = viewChild<ElementRef<HTMLInputElement>>('labelInput');
  private readonly api = inject(ApiService);
  private readonly meta = inject(MetaService);
  private readonly toast = inject(ToastService);
  private readonly destroy = inject(DestroyRef);

  readonly refOptions = computed(() =>
    Object.values(this.meta.meta()?.entities ?? {})
      .filter((item) => item.key !== this.entity().key && item.can?.['view'])
      .sort((left, right) => left.label.localeCompare(right.label, 'th')),
  );

  readonly options = computed(() => this.optionRows().map((row) => row.id));
  readonly optionMeta = computed(() => this.optionRows().map((row) => ({
    id: row.id,
    label: row.label || row.id,
    color: row.color,
    archived: row.archived || undefined,
  })));
  readonly displayFields = computed(() => {
    const target = this.meta.entity(this.refTarget());
    if (!target) return [];
    return target.fields.filter((field) =>
      !field.sensitive && ['text', 'email', 'phone', 'url', 'number', 'date', 'select'].includes(field.type));
  });

  readonly canBacklink = computed(() => {
    const target = this.meta.entity(this.refTarget());
    return !!target && !target.system;
  });

  readonly dirty = computed(() =>
    !!this.label().trim() || !!this.key() || this.type() !== 'text' || this.optionRows().length > 0 ||
    this.required() || !!this.help().trim() || this.decimals() !== '' || this.min() !== '' || this.max() !== '' || !!this.currency() || this.maxLength() !== '' || !!this.refTarget() || this.multiple() || this.backlink(),
  );

  ngOnInit(): void {
    setTimeout(() => this.labelInput()?.nativeElement.focus(), 0);
    this.api.get<{ id: string; name: string }[]>('/roles')
      .pipe(takeUntilDestroyed(this.destroy))
      .subscribe({ next: (rows) => this.roles.set(rows), error: () => this.roles.set([]) });
  }

  setLabel(value: string): void {
    this.label.set(value);
    if (!this.keyEdited) this.key.set(this.deriveKey(value));
    this.fieldErrors.update((errors) => ({ ...errors, label: '' }));
  }

  setKey(value: string): void {
    this.keyEdited = true;
    this.key.set(value.toLowerCase().replace(/[^a-z0-9_]/g, ''));
    this.refreshImpact();
  }

  setType(value: string): void {
    const type = this.types.some(([key]) => key === value) ? (value as DrawerType) : 'text';
    this.type.set(type);
    this.error.set('');
    if (type !== 'ref') {
      this.refTarget.set('');
      this.multiple.set(false);
      this.displayField.set('');
      this.backlink.set(false);
    }
    if (type !== 'select' && type !== 'multiselect') this.optionRows.set([]);
    if (type !== 'select' && type !== 'multiselect' && type !== 'ref') this.refreshImpact();
  }

  addOption(): void {
    if (this.optionRows().length >= 30) return;
    const index = this.optionRows().length + 1;
    this.optionRows.update((rows) => [...rows, { id: `option${index}`, label: '', color: 'gray', archived: false, roles: [] }]);
  }

  toggleOptionRole(index: number, roleId: string, event: Event): void {
    const checked = this.checked(event);
    this.optionRows.update((rows) => rows.map((row, i) => i === index
      ? { ...row, roles: checked ? [...new Set([...row.roles, roleId])] : row.roles.filter((id) => id !== roleId) }
      : row));
  }

  openOptionEditor(field: FieldDef): void {
    if (field.type !== 'select' && field.type !== 'multiselect') return;
    const meta = new Map((field.optionMeta ?? []).map((option) => [option.id, option]));
    this.editOptionsKey.set(field.key);
    this.editOptionRows.set((field.options ?? []).map((id) => {
      const option = meta.get(id);
      return {
        id,
        label: option?.label ?? id,
        color: option?.color ?? 'gray',
        archived: !!option?.archived,
        roles: option?.roles ?? [],
      };
    }));
    this.error.set('');
  }

  closeOptionEditor(): void {
    if (this.editOptionsBusy()) return;
    this.editOptionsKey.set('');
  }

  addEditOption(): void {
    if (this.editOptionRows().length >= 30) return;
    this.editOptionRows.update((rows) => [...rows, {
      id: `option${rows.length + 1}`,
      label: '',
      color: 'gray',
      archived: false,
      roles: [],
    }]);
  }

  removeEditOption(index: number): void {
    this.editOptionRows.update((rows) => rows.filter((_row, i) => i !== index));
  }

  setEditOption(index: number, key: keyof OptionRow, value: string | boolean): void {
    this.editOptionRows.update((rows) => rows.map((row, i) => i === index ? { ...row, [key]: value } : row));
  }

  toggleEditOptionRole(index: number, roleId: string, event: Event): void {
    const checked = this.checked(event);
    this.editOptionRows.update((rows) => rows.map((row, i) => i === index
      ? { ...row, roles: checked ? [...new Set([...row.roles, roleId])] : row.roles.filter((id) => id !== roleId) }
      : row));
  }

  saveOptionEditor(): void {
    const key = this.editOptionsKey();
    if (!key || this.editOptionsBusy()) return;
    const rows = this.editOptionRows();
    const ids = rows.map((row) => row.id.trim());
    if (ids.some((id) => !/^[A-Za-z0-9_-]{1,40}$/.test(id)) || new Set(ids).size !== ids.length) {
      this.error.set('id ตัวเลือกต้องไม่ซ้ำและใช้ a-z 0-9 _ -');
      return;
    }
    this.editOptionsBusy.set(true);
    this.error.set('');
    this.api.patch(`/meta/entity/${encodeURIComponent(this.entity().key)}/field/${encodeURIComponent(key)}`, {
      options: ids,
      optionMeta: rows.map((row) => ({
        id: row.id.trim(),
        label: row.label.trim() || row.id.trim(),
        color: row.color,
        archived: row.archived || undefined,
        roles: row.roles.length ? row.roles : undefined,
      })),
    }).pipe(takeUntilDestroyed(this.destroy)).subscribe({
      next: () => {
        this.editOptionsBusy.set(false);
        this.editOptionsKey.set('');
        this.meta.load(true);
        this.toast.show(`บันทึกตัวเลือก/สิทธิ์ของ "${this.fieldLabel(key)}" แล้ว`);
      },
      error: (error: unknown) => {
        this.editOptionsBusy.set(false);
        this.error.set(apiErrorMessage(error));
      },
    });
  }

  removeOption(index: number): void {
    this.optionRows.update((rows) => rows.filter((_row, i) => i !== index));
    this.fieldErrors.update((errors) => ({ ...errors, options: '' }));
  }

  setOption(index: number, key: keyof OptionRow, value: string | boolean): void {
    this.optionRows.update((rows) => rows.map((row, i) => i === index ? { ...row, [key]: value } : row));
    this.fieldErrors.update((errors) => ({ ...errors, options: '' }));
  }

  toggleRequired(event: Event): void {
    this.required.set(this.checked(event));
    this.refreshImpact();
  }

  setRefTarget(value: string): void {
    this.refTarget.set(value);
    const target = this.meta.entity(value);
    this.displayField.set(target?.title === 'code' ? '' : target?.title ?? '');
    this.multiple.set(false);
    this.backlinkMultiple.set(false);
    this.backlinkKey.set(`${this.entity().key}Ref`);
    this.backlinkLabel.set(`${this.entity().label} (อ้างอิง)`);
    if (!target || target.system) this.backlink.set(false);
    this.fieldErrors.update((errors) => ({ ...errors, ref: '' }));
  }

  setMultiple(event: Event): void {
    this.multiple.set(this.checked(event));
  }

  setBacklink(event: Event): void {
    const next = this.checked(event);
    if (next && !this.refTarget()) {
      this.fieldErrors.update((errors) => ({ ...errors, ref: 'เลือก Relation ปลายทางก่อนเปิดลิงก์ย้อนกลับ' }));
      return;
    }
    this.backlink.set(next);
    if (!next) this.backlinkMultiple.set(false);
  }

  setBacklinkMultiple(event: Event): void {
    this.backlinkMultiple.set(this.checked(event));
  }

  setFieldType(key: string, value: string): void {
    this.fieldTypeDraft.update((draft) => ({ ...draft, [key]: value }));
    this.pendingConvert.set(null);
  }

  fieldLabel(key: string): string {
    return this.entity().fields.find((field) => field.key === key)?.label ?? key;
  }

  changeFieldType(key: string): void {
    if (this.fieldActionBusy()) return;
    const type = this.fieldTypeDraft()[key] ?? this.entity().fields.find((field) => field.key === key)?.type ?? 'text';
    this.patchField(key, { type });
  }

  confirmChangeType(): void {
    const pending = this.pendingConvert();
    if (!pending) return;
    this.pendingConvert.set(null);
    this.patchField(pending.key, { type: pending.type, confirm: true });
  }

  toggleFieldArchive(field: FieldDef): void {
    if (this.fieldActionBusy()) return;
    this.patchField(field.key, { archived: !field.archived });
  }

  private patchField(key: string, body: { type?: string; archived?: boolean; confirm?: boolean }): void {
    if (this.fieldActionBusy()) return;
    this.fieldActionBusy.set(key);
    this.error.set('');
    this.api.patch<{ converted: number; cleared: number; views: { id: string; name: string }[] }>(
      `/meta/entity/${encodeURIComponent(this.entity().key)}/field/${encodeURIComponent(key)}`, body,
    ).pipe(takeUntilDestroyed(this.destroy)).subscribe({
      next: (result) => {
        this.fieldActionBusy.set('');
        this.fieldTypeDraft.update((draft) => {
          const next = { ...draft };
          delete next[key];
          return next;
        });
        this.meta.load(true);
        const parts = [
          body.type ? `เปลี่ยนชนิดฟิลด์ "${this.fieldLabel(key)}" เป็น ${this.typeLabel(body.type)}` : '',
          body.archived === true ? `เก็บถาวรฟิลด์ "${this.fieldLabel(key)}"` : body.archived === false ? `คืนสถานะฟิลด์ "${this.fieldLabel(key)}"` : '',
          result.converted ? `แปลงค่า ${result.converted} รายการ` : '',
          result.cleared ? `ล้างค่า ${result.cleared} รายการ` : '',
          result.views.length ? `มี ${result.views.length} มุมมองที่ใช้ฟิลด์นี้` : '',
        ].filter(Boolean);
        this.toast.show(parts.join(' · ') || 'บันทึกแล้ว');
      },
      error: (error: unknown) => {
        this.fieldActionBusy.set('');
        const message = apiErrorMessage(error);
        if (message.includes('confirm=true') && body.type) {
          this.pendingConvert.set({ key, type: body.type });
        }
        this.error.set(message);
      },
    });
  }

  refreshImpact(): void {
    const key = this.key().trim();
    if (!this.required() || !key) {
      this.impact.set(null);
      return;
    }
    this.impactBusy.set(true);
    this.api.get<{
      affected: number;
      total: number;
      views: { id: string; name: string; visibility: string }[];
      workflows: string[];
    }>(
      `/meta/entity/${encodeURIComponent(this.entity().key)}/field-impact`, { field: key },
    ).pipe(takeUntilDestroyed(this.destroy)).subscribe({
      next: (result) => {
        this.impact.set(result);
        this.impactBusy.set(false);
      },
      error: () => {
        this.impact.set(null);
        this.impactBusy.set(false);
      },
    });
  }

  review(): void {
    if (this.busy()) return;
    if (!this.validate()) return;
    this.reviewing.set(true);
    setTimeout(() => document.querySelector('[aria-label="ตรวจก่อนสร้างฟิลด์"]')?.scrollIntoView({ block: 'nearest' }));
  }

  reviewSummary(): { rule: string; scope: string; views: string } {
    const parts: string[] = [];
    if (this.type() === 'number') {
      if (this.decimals() !== '') parts.push(`ทศนิยม ${this.decimals()} ตำแหน่ง`);
      if (this.min() !== '' || this.max() !== '') parts.push(`ช่วง ${this.min() || 'ไม่จำกัด'} ถึง ${this.max() || 'ไม่จำกัด'}`);
      if (this.currency().trim()) parts.push(`สกุลเงิน ${this.currency().trim().toUpperCase()} (ไม่รวมยอดต่างสกุล)`);
    }
    if ((this.type() === 'text' || this.type() === 'textarea') && this.maxLength() !== '') parts.push(`ยาวไม่เกิน ${this.maxLength()} ตัวอักษร`);
    if (this.required()) parts.push('บังคับกรอก');
    const impact = this.impact();
    return {
      rule: parts.join(' · ') || 'ไม่มีกฎเพิ่มเติม',
      scope: impact
        ? impact.affected
          ? `รายการเดิม ${impact.affected} จาก ${impact.total} รายการยังไม่มีค่า (ระบบไม่เติมให้อัตโนมัติ)`
          : `รายการเดิม ${impact.total} รายการไม่ถูกแก้ค่า`
        : 'รายการเดิมไม่ถูกแก้ค่า',
      views: this.showInView() ? 'แสดงในมุมมองปัจจุบันของคุณเท่านั้น มุมมองอื่นไม่เปลี่ยน' : 'ยังไม่แสดงในมุมมองใด (เปิดได้จากเมนูคอลัมน์)',
    };
  }

  private validate(): boolean {
    const errors: Record<string, string> = {};
    const label = this.label().trim();
    const key = this.key().trim();
    if (!label) errors['label'] = 'กรอกชื่อฟิลด์';
    if (!/^[a-zA-Z][A-Za-z0-9_]*$/.test(key)) errors['key'] = 'key ต้องขึ้นต้นด้วยตัวอักษร และใช้ a-z 0-9 _ ได้';
    if (this.type() === 'select' || this.type() === 'multiselect') {
      if (!this.optionRows().length) {
        errors['options'] = 'เพิ่มตัวเลือกอย่างน้อย 1 รายการ';
      } else {
        const ids = this.optionRows().map((row) => row.id.trim());
        if (ids.some((id) => !/^[A-Za-z0-9_-]{1,40}$/.test(id))) {
          errors['options'] = 'id ตัวเลือกใช้ a-z 0-9 _ - ยาวไม่เกิน 40 ตัว';
        } else if (new Set(ids).size !== ids.length) {
          errors['options'] = 'id ตัวเลือกซ้ำ';
        }
      }
    }
    if (this.type() === 'ref' && !this.refTarget()) errors['ref'] = 'เลือก Relation ปลายทาง';
    if (this.type() === 'number') {
      const decimals = this.decimals(), min = this.min(), max = this.max();
      if (decimals !== '' && !(Number.isInteger(Number(decimals)) && Number(decimals) >= 0 && Number(decimals) <= 6)) errors['decimals'] = 'ทศนิยมต้องเป็นจำนวนเต็ม 0–6';
      if (min !== '' && !Number.isFinite(Number(min))) errors['min'] = 'ค่าต่ำสุดต้องเป็นตัวเลข';
      if (max !== '' && !Number.isFinite(Number(max))) errors['max'] = 'ค่าสูงสุดต้องเป็นตัวเลข';
      if (!errors['min'] && !errors['max'] && min !== '' && max !== '' && Number(min) > Number(max)) errors['min'] = 'ค่าต่ำสุดต้องไม่มากกว่าค่าสูงสุด';
      if (this.currency().trim() && !/^[A-Za-z]{3}$/.test(this.currency().trim())) errors['currency'] = 'รหัสสกุลเงิน 3 ตัวอักษร เช่น THB';
    }
    if ((this.type() === 'text' || this.type() === 'textarea') && this.maxLength() !== '' &&
      !(Number.isInteger(Number(this.maxLength())) && Number(this.maxLength()) >= 1 && Number(this.maxLength()) <= 10000)) {
      errors['maxLength'] = 'ความยาวสูงสุด 1–10000';
    }
    this.fieldErrors.set(errors);
    this.error.set('');
    if (Object.keys(errors).length) {
      this.focusFirstError(errors);
      return false;
    }
    return true;
  }

  create(): void {
    if (this.busy()) return;
    if (!this.validate()) return;
    const label = this.label().trim();
    const key = this.key().trim();
    this.busy.set(true);
    const isSelect = this.type() === 'select' || this.type() === 'multiselect';
    const body = {
      field: {
        key,
        label,
        type: this.type(),
        required: this.required(),
        wide: this.wide(),
        help: this.help().trim() || undefined,
        decimals: this.type() === 'number' && this.decimals() !== '' ? Number(this.decimals()) : undefined,
        min: this.type() === 'number' && this.min() !== '' ? Number(this.min()) : undefined,
        max: this.type() === 'number' && this.max() !== '' ? Number(this.max()) : undefined,
        currency: this.type() === 'number' && this.currency().trim() ? this.currency().trim().toUpperCase() : undefined,
        maxLength: (this.type() === 'text' || this.type() === 'textarea') && this.maxLength() !== '' ? Number(this.maxLength()) : undefined,
        ref: this.type() === 'ref' ? this.refTarget() : undefined,
        multiple: this.type() === 'ref' ? this.multiple() : undefined,
        displayField: this.type() === 'ref'
          ? (this.displayField() || (this.meta.entity(this.refTarget())?.title === 'code' ? undefined : this.meta.entity(this.refTarget())?.title))
          : undefined,
        options: isSelect ? this.optionRows().map((row) => row.id.trim()) : undefined,
        optionMeta: isSelect
          ? this.optionRows().map((row) => ({
              id: row.id.trim(),
              label: row.label.trim() || row.id.trim(),
              color: row.color,
              archived: row.archived || undefined,
              roles: row.roles.length ? row.roles : undefined,
            }))
          : undefined,
      },
      confirmRequired: this.required() && !!this.impact()?.affected,
      backlink: this.type() === 'ref' && this.backlink() && this.refTarget()
        ? { entity: this.refTarget(), key: this.backlinkKey(), label: this.backlinkLabel(), multiple: this.backlinkMultiple() || undefined }
        : undefined,
    };
    this.api.post<{ entity: EntityDef; field: FieldDef; backlink?: { entity: EntityDef; field: FieldDef } }>(
      `/meta/entity/${encodeURIComponent(this.entity().key)}/fields`, body,
    ).pipe(takeUntilDestroyed(this.destroy)).subscribe({
      next: (result) => {
        this.busy.set(false);
        this.meta.load(true);
        this.toast.show(`สร้างฟิลด์ ${result.field.label} แล้ว`);
        this.created.emit({
          entity: this.entity().key,
          field: result.field,
          backlink: result.backlink
            ? { entity: result.backlink.entity.key, key: result.backlink.field.key, label: result.backlink.field.label }
            : undefined,
          showInView: this.showInView(),
        });
        this.closed.emit();
      },
      error: (error: unknown) => {
        this.busy.set(false);
        const message = apiErrorMessage(error);
        const mapped: Record<string, string> = {};
        if (message.includes('ชื่อฟิลด์')) mapped['label'] = message;
        else if (message.includes('key')) mapped['key'] = message;
        else if (message.includes('ตัวเลือก')) mapped['options'] = message;
        else if (message.includes('ปลายทาง')) mapped['ref'] = message;
        this.fieldErrors.set(mapped);
        this.error.set(Object.keys(mapped).length ? '' : message);
        this.focusFirstError(mapped);
      },
    });
  }

  requestClose(): void {
    if (this.busy()) return;
    if (this.dirty()) this.askingDiscard.set(true);
    else this.closed.emit();
  }

  discard(): void {
    this.askingDiscard.set(false);
    this.closed.emit();
  }

  typeLabel(type: string): string {
    return this.types.find(([key]) => key === type)?.[1] ?? type;
  }

  impactViews(result: { views: { name: string }[] }): string {
    const names = result.views.slice(0, 3).map((view) => view.name);
    return result.views.length > 3 ? `${names.join(', ')} และอื่น ๆ` : names.join(', ');
  }

  metaLabel(key: string): string {
    return this.meta.entity(key)?.label ?? key;
  }

  inputValue(event: Event): string {
    return event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement ||
      event.target instanceof HTMLSelectElement ? event.target.value : '';
  }

  checked(event: Event): boolean {
    const target = event.target;
    return !!target && typeof target === 'object' && 'checked' in target && target.checked === true;
  }

  private focusFirstError(errors: Record<string, string>): void {
    const first = Object.keys(errors)[0];
    if (!first) return;
    setTimeout(() => {
      const input = document.getElementById(`schema-${first}`);
      input?.focus();
      input?.scrollIntoView({ block: 'nearest' });
    });
  }

  private deriveKey(label: string): string {
    const base = label.toLowerCase().normalize('NFKD')
      .replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 30);
    // Thai and other non-Latin labels cannot be transliterated reliably, so ask for the key instead of inventing one.
    if (!base) return '';
    let key = base;
    if (!/^[a-zA-Z]/.test(key)) key = `f_${key}`;
    const used = new Set(this.entity().fields.map((field) => field.key));
    let candidate = key;
    let n = 2;
    while (used.has(candidate)) candidate = `${key}${n++}`;
    return candidate;
  }
}
