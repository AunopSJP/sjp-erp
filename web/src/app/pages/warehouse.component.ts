import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { ApiService, apiErrorMessage } from '../core/api.service';
import { AuthService } from '../core/auth.service';
import { MetaService } from '../core/meta.service';
import { fmtDateTime } from '../core/util';
import type { ColumnDef } from '../shared/data-table.component';
import { DataTableComponent } from '../shared/data-table.component';
import { RecordFormComponent } from '../shared/record-form.component';
import { ToastService } from '../shared/toast.service';
import type { ListResponse, Option, RecordRow } from '../core/models';

const TYPES: [string, string][] = [
  ['receive', 'รับเข้า (ไม่มี PO)'],
  ['issue', 'เบิกออก'],
  ['transfer', 'โอนย้ายระหว่างคลัง'],
  ['return', 'รับคืน'],
  ['adjust', 'ปรับยอด'],
];

@Component({
  selector: 'app-warehouse',
  standalone: true,
  imports: [DataTableComponent, RecordFormComponent],
  template: `
    <div class="page">
      <div class="page-head"><div><h1>คลังสินค้า</h1><div class="muted">ยอดคงเหลือ รับเข้า เบิก โอน</div></div>
        <div class="page-actions">@if (auth.can('warehouse','create')) { <button type="button" class="btn primary" (click)="tab.set('do')">+ ทำรายการ</button> }</div>
      </div>
      <div class="tabs">
        <button type="button" [class.active]="tab() === 'bal'" (click)="tab.set('bal')">ยอดคงเหลือ</button>
        <button type="button" [class.active]="tab() === 'do'" (click)="tab.set('do')">รับเข้า/เบิก/โอน</button>
        <button type="button" [class.active]="tab() === 'moves'" (click)="tab.set('moves')">ความเคลื่อนไหว</button>
        <button type="button" [class.active]="tab() === 'wh'" (click)="tab.set('wh')">รายชื่อคลัง</button>
      </div>

      @if (tab() === 'bal') {
        @if (!items().length) { <div class="state empty">ยังไม่มีสินค้า</div> }
        @else {
          <div class="tablecard"><div class="table-wrap"><table class="tbl">
            <thead><tr><th scope="col">SKU</th><th scope="col">สินค้า</th>@for (wh of warehouses(); track wh.value) { <th scope="col">{{ wh.label }}</th> }<th scope="col">รวม</th><th scope="col">ขั้นต่ำ</th><th scope="col">สถานะ</th></tr></thead>
            <tbody>@for (item of items(); track item.id) {
              <tr><td>{{ item['sku'] }}</td><td>{{ item['name'] }}</td>@for (wh of warehouses(); track wh.value) { <td>{{ balance(wh.value, item.id) }}</td> }<td><b>{{ total(item.id) }}</b></td><td>{{ item['minStock'] || 0 }}</td><td>@if (isLow(item)) { <span class="badge red">ต่ำกว่าขั้นต่ำ</span> } @else { <span class="badge green">ปกติ</span> }</td></tr>
            }</tbody>
          </table></div></div>
        }
      }

      @if (tab() === 'do') {
        @if (!auth.can('warehouse','create')) { <div class="state empty">ไม่มีสิทธิ์ทำรายการคลัง</div> }
        @else {
          @if (!items().length || !warehouses().length) {
            <div class="notice small">
              ต้องมีสินค้าและคลังอย่างน้อย 1 รายการก่อนทำรายการ —
              เพิ่มสินค้าที่เมนู “สินค้า/อุปกรณ์” และเพิ่มคลังจากแท็บ “รายชื่อคลัง”
            </div>
          }
          <div class="card">
            <div class="row" style="margin-bottom:10px">@for (type of types; track type[0]) { <button type="button" class="btn" [class.primary]="moveType() === type[0]" (click)="setType(type[0])">{{ type[1] }}</button> }</div>
            <div class="form-grid">
              <div class="field"><label for="lf-warehouse-component-1">สินค้า/อะไหล่ *</label><select id="lf-warehouse-component-1" [value]="itemId()" (change)="setItem($any($event.target).value)"><option value="" [selected]="!itemId()">– เลือก –</option>@for (item of items(); track item.id) { <option [value]="item.id" [selected]="item.id === itemId()">{{ item['name'] }}{{ item['trackSerial'] ? ' [Serial]' : '' }}</option> }</select></div>
              @if (moveType() === 'adjust') { <div class="field"><label for="lf-warehouse-component-2">ทิศทาง</label><select id="lf-warehouse-component-2" [value]="direction()" (change)="direction.set($any($event.target).value)"><option value="เพิ่ม" [selected]="direction() === 'เพิ่ม'">เพิ่ม</option><option value="ลด" [selected]="direction() === 'ลด'">ลด</option></select></div> }
              @if (needFrom()) { <div class="field"><label for="lf-warehouse-component-3">คลังต้นทาง *</label><select id="lf-warehouse-component-3" [value]="from()" (change)="from.set($any($event.target).value); selectedSerials.set([])"><option value="" [selected]="!from()">– เลือก –</option>@for (wh of warehouses(); track wh.value) { <option [value]="wh.value" [selected]="wh.value === from()">{{ wh.label }} (คงเหลือ {{ balance(wh.value, itemId()) }})</option> }</select></div> }
              @if (needTo()) { <div class="field"><label for="lf-warehouse-component-4">คลังปลายทาง *</label><select id="lf-warehouse-component-4" [value]="to()" (change)="to.set($any($event.target).value)"><option value="" [selected]="!to()">– เลือก –</option>@for (wh of warehouses(); track wh.value) { <option [value]="wh.value" [selected]="wh.value === to()">{{ wh.label }}</option> }</select></div> }
              @if (selectedItem()?.['trackSerial'] && moveType() === 'receive') {
                <div class="field wide"><label for="lf-warehouse-component-5">Serial Number ที่รับ (คั่นด้วยขึ้นบรรทัดใหม่หรือ ,) *</label><textarea id="lf-warehouse-component-5" rows="3" [value]="serialText()" (input)="serialText.set($any($event.target).value)"></textarea></div>
              } @else if (selectedItem()?.['trackSerial'] && moveType() !== 'adjust') {
                <div class="field wide"><label>เลือก Serial *</label>
                  @if (!selectableSerials().length) { <span class="muted">ไม่มี Serial ที่เลือกได้</span> }
                  @else { <div class="row">@for (serial of selectableSerials(); track serial.id) { <label class="check"><input type="checkbox" [checked]="selectedSerials().includes(serial.id)" (change)="toggleSerial(serial.id, $event)" /> {{ serial['serialNo'] }} ({{ serial['status'] }})</label> }</div> }
                </div>
              } @else {
                <div class="field"><label for="lf-warehouse-component-6">จำนวน *</label><input id="lf-warehouse-component-6" type="number" min="0" step="any" [value]="qty()" (input)="qty.set($any($event.target).value)" /></div>
              }
              @if (moveType() === 'issue') {
                <div class="field"><label for="lf-warehouse-component-7">โครงการ</label><select id="lf-warehouse-component-7" [value]="project()" (change)="project.set($any($event.target).value)"><option value="" [selected]="!project()">–</option>@for (option of projects(); track option.value) { <option [value]="option.value" [selected]="option.value === project()">{{ option.label }}</option> }</select></div>
                <div class="field"><label for="lf-warehouse-component-8">ไซต์</label><select id="lf-warehouse-component-8" [value]="site()" (change)="site.set($any($event.target).value)"><option value="" [selected]="!site()">–</option>@for (option of sites(); track option.value) { <option [value]="option.value" [selected]="option.value === site()">{{ option.label }}</option> }</select></div>
                <div class="field"><label for="lf-warehouse-component-9">Ticket</label><select id="lf-warehouse-component-9" [value]="ticket()" (change)="ticket.set($any($event.target).value)"><option value="" [selected]="!ticket()">–</option>@for (option of tickets(); track option.value) { <option [value]="option.value" [selected]="option.value === ticket()">{{ option.label }}</option> }</select></div>
                <div class="field"><label for="lf-warehouse-component-10">ผู้รับ</label><input id="lf-warehouse-component-10" [value]="recipient()" (input)="recipient.set($any($event.target).value)" /></div>
              }
              <div class="field wide"><label for="lf-warehouse-component-11">หมายเหตุ{{ moveType() === 'adjust' ? ' / เหตุผล *' : '' }}</label><textarea id="lf-warehouse-component-11" rows="2" [value]="note()" (input)="note.set($any($event.target).value)"></textarea></div>
            </div>
            @if (error()) { <div class="err" role="alert" style="margin-top:8px">{{ error() }}</div> }
            <div class="form-actions"><button type="button" class="btn primary" [disabled]="busy()" (click)="submit()">{{ busy() ? 'กำลังบันทึก…' : 'บันทึกรายการ' }}</button></div>
          </div>
        }
      }

      @if (tab() === 'moves') {
        <app-data-table [columns]="moveColumns()" [rows]="moves()" [exportName]="'stock-moves'" [viewsEntity]="'stockMoves'" [canShareViews]="auth.can('settings', 'edit')" [canExport]="auth.can('warehouse','export')" [emptyText]="'ยังไม่มีรายการเคลื่อนไหว'" [error]="movesError()" [rowClass]="rowClass" (retry)="load()" />
      }

      @if (tab() === 'wh') {
        <div class="card">
          @if (auth.can('warehouse','create')) { <button type="button" class="btn sm" (click)="whForm.set(true)">+ เพิ่มคลัง</button> }
          @for (wh of warehouses(); track wh.value) { <div style="padding:6px 0">{{ wh.label }}</div> }
        </div>
      }
    </div>
    @if (whForm()) { <app-record-form entity="warehouses" entityLabel="คลังสินค้า" [fields]="warehouseFields()" [lists]="meta.lists()" (saved)="onWarehouseSaved()" (closed)="whForm.set(false)" /> }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class WarehouseComponent implements OnInit {
  readonly auth = inject(AuthService);
  readonly meta = inject(MetaService);
  private readonly api = inject(ApiService);
  private readonly toast = inject(ToastService);

  readonly tab = signal<'bal' | 'do' | 'moves' | 'wh'>('bal');
  readonly items = signal<RecordRow[]>([]);
  readonly warehouses = signal<Option[]>([]);
  readonly balances = signal<Record<string, Record<string, number>>>({});
  readonly moves = signal<RecordRow[]>([]);
  readonly movesError = signal('');
  readonly serials = signal<RecordRow[]>([]);
  readonly projects = signal<Option[]>([]);
  readonly sites = signal<Option[]>([]);
  readonly tickets = signal<Option[]>([]);
  readonly moveType = signal('receive');
  readonly itemId = signal('');
  readonly from = signal('');
  readonly to = signal('');
  readonly direction = signal('เพิ่ม');
  readonly qty = signal('1');
  readonly serialText = signal('');
  readonly selectedSerials = signal<string[]>([]);
  readonly project = signal('');
  readonly site = signal('');
  readonly ticket = signal('');
  readonly recipient = signal('');
  readonly note = signal('');
  readonly error = signal('');
  readonly busy = signal(false);
  readonly whForm = signal(false);
  readonly types = TYPES;
  readonly fmtDateTime = fmtDateTime;
  readonly rowClass = () => '';
  readonly warehouseFields = computed(() => this.meta.entity('warehouses')?.fields ?? []);
  readonly selectedItem = computed(() => this.items().find((item) => item.id === this.itemId()));
  readonly needFrom = computed(() => ['issue', 'transfer'].includes(this.moveType()) || (this.moveType() === 'adjust' && this.direction() === 'ลด'));
  readonly needTo = computed(() => ['transfer', 'return', 'receive'].includes(this.moveType()) || (this.moveType() === 'adjust' && this.direction() === 'เพิ่ม'));
  readonly selectableSerials = computed(() => {
    const item = this.itemId();
    const from = this.from();
    return this.serials().filter((serial) => {
      if (serial['item'] !== item) return false;
      if (this.moveType() === 'return') return !serial['warehouse'];
      return serial['warehouse'] === from;
    });
  });

  ngOnInit(): void {
    this.meta.load();
    this.load();
    this.api.get<Option[]>('/meta/options/projects').subscribe({ next: (rows) => this.projects.set(rows) });
    this.api.get<Option[]>('/meta/options/sites').subscribe({ next: (rows) => this.sites.set(rows) });
    this.api.get<Option[]>('/meta/options/tickets').subscribe({ next: (rows) => this.tickets.set(rows) });
  }

  load(): void {
    this.movesError.set('');
    this.api.get<ListResponse<RecordRow>>('/records/items', { pageSize: 500 }).subscribe({ next: (result) => this.items.set(result.items), error: () => this.items.set([]) });
    this.api.get<ListResponse<RecordRow>>('/records/warehouses', { pageSize: 500 }).subscribe({
      next: (result) => {
        this.warehouses.set(result.items.map((row) => ({ value: row.id, label: String(row['name'] ?? row.code) })));
        if (!this.to()) this.to.set(result.items[0]?.id ?? '');
      },
      error: () => this.warehouses.set([]),
    });
    this.api.get<Record<string, Record<string, number>>>('/stock/balances').subscribe({ next: (balances) => this.balances.set(balances), error: () => this.balances.set({}) });
    this.api.get<ListResponse<RecordRow>>('/stock/moves', { pageSize: 500, sort: '-date' }).subscribe({
      next: (result) => this.moves.set(result.items),
      error: (error: unknown) => {
        this.movesError.set(apiErrorMessage(error));
        this.moves.set([]);
      },
    });
    this.api.get<ListResponse<RecordRow>>('/records/serials', { pageSize: 500 }).subscribe({ next: (result) => this.serials.set(result.items), error: () => this.serials.set([]) });
  }

  setType(type: string): void {
    this.moveType.set(type);
    this.selectedSerials.set([]);
  }

  setItem(id: string): void {
    this.itemId.set(id);
    this.selectedSerials.set([]);
    this.serialText.set('');
  }

  toggleSerial(id: string, event: Event): void {
    const checked = (event.target as HTMLInputElement).checked;
    this.selectedSerials.update((serials) => (checked ? [...serials, id] : serials.filter((serial) => serial !== id)));
  }

  balance(warehouse: string, item: string): number {
    return this.balances()[warehouse]?.[item] ?? 0;
  }

  total(item: string): number {
    return Object.values(this.balances()).reduce((sum, wh) => sum + (wh[item] ?? 0), 0);
  }

  isLow(item: RecordRow): boolean {
    const min = Number(item['minStock'] ?? 0);
    return min > 0 && this.total(item.id) < min;
  }

  moveColumns(): ColumnDef[] {
    return [
      { key: 'code', label: 'เลขที่' },
      { key: 'date', label: 'วันที่', value: (row) => fmtDateTime(row['date']) },
      { key: 'type', label: 'ประเภท', value: (row) => this.typeLabel(row['type']) },
      { key: 'item', label: 'สินค้า', value: (row) => row._labels?.['item'] ?? '–' },
      { key: 'qty', label: 'จำนวน' },
      { key: 'from', label: 'จาก', value: (row) => this.warehouseLabel(row['from']) },
      { key: 'to', label: 'ไป', value: (row) => this.warehouseLabel(row['to']) },
      { key: 'ref', label: 'อ้างอิง', value: (row) => [row._labels?.['po'], row._labels?.['project'], row._labels?.['ticket']].filter(Boolean).join(' / ') || '–' },
      { key: 'recipient', label: 'ผู้รับ' },
    ];
  }

  typeLabel(type: unknown): string {
    return TYPES.find(([key]) => key === type)?.[1] ?? String(type ?? '–');
  }

  warehouseLabel(id: unknown): string {
    if (!id) return '–';
    return this.warehouses().find((warehouse) => warehouse.value === id)?.label ?? String(id);
  }

  submit(): void {
    if (this.busy()) return;
    this.error.set('');
    this.busy.set(true);
    const type = this.moveType();
    const base = {
      type,
      item: this.itemId(),
      note: this.note(),
      project: this.project() || null,
      site: this.site() || null,
      ticket: this.ticket() || null,
      recipient: this.recipient(),
    };
    if (type === 'receive') {
      if (!this.selectedItem()?.['trackSerial']) {
        this.api.post('/stock/receive', { item: this.itemId(), qty: this.qty(), to: this.to(), note: this.note(), recipient: this.recipient() }).subscribe({ next: () => this.done(), error: (error: unknown) => this.fail(error) });
      } else {
        this.api.post('/stock/receive', { item: this.itemId(), to: this.to(), serialNos: this.serialText().split(/[\n,]+/).map((s) => s.trim()).filter(Boolean), note: this.note(), recipient: this.recipient() }).subscribe({ next: () => this.done(), error: (error: unknown) => this.fail(error) });
      }
      return;
    }
    const track = !!this.selectedItem()?.['trackSerial'];
    const payload = {
      ...base,
      from: this.needFrom() ? this.from() : null,
      to: this.needTo() ? this.to() : null,
      qty: track ? this.selectedSerials().length : this.qty(),
      serials: track ? this.selectedSerials() : [],
    };
    this.api.post('/stock/moves', payload).subscribe({ next: () => this.done(), error: (error: unknown) => this.fail(error) });
  }

  done(): void {
    this.busy.set(false);
    this.toast.show('บันทึกรายการแล้ว');
    this.qty.set('1');
    this.serialText.set('');
    this.selectedSerials.set([]);
    this.note.set('');
    this.load();
  }

  fail(error: unknown): void {
    this.busy.set(false);
    this.error.set(apiErrorMessage(error));
  }

  onWarehouseSaved(): void {
    this.whForm.set(false);
    this.load();
  }
}
