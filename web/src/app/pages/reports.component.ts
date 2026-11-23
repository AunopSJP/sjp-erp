import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { ApiService, apiErrorMessage } from '../core/api.service';
import { AuthService } from '../core/auth.service';
import { fmtDate, fmtDuration, fmtMoney } from '../core/util';
import type { ColumnDef } from '../shared/data-table.component';
import { DataTableComponent } from '../shared/data-table.component';
import { ToastService } from '../shared/toast.service';
import type { RecordRow } from '../core/models';

type ReportName = 'tickets' | 'projects' | 'service-contracts' | 'revenue-share' | 'monthly-service' | 'serials' | 'stock' | 'boq';

@Component({
  selector: 'app-reports',
  standalone: true,
  imports: [DataTableComponent],
  template: `
    <div class="page">
      <div class="page-head"><div><h1>รายงานและส่งออกข้อมูล</h1><div class="muted">ทุกแถวเปิดย้อนไปยังเอกสารต้นทางได้ · ส่งออกเป็น CSV (เปิดใน Excel ได้)</div></div></div>
      <div class="tabs">
        @for (tab of tabs(); track tab[0]) { <button type="button" [class.active]="active() === tab[0]" (click)="select(tab[0])">{{ tab[1] }}</button> }
      </div>
      @if (error()) { <div class="state error">{{ error() }}</div> }
      @else if (loading()) { <div class="state"><div class="spinner"></div>กำลังโหลดรายงาน…</div> }
      @else if (!tabs().length) { <div class="state empty">ไม่มีรายงานที่คุณมีสิทธิ์ดู</div> }
      @else {
        <app-data-table [columns]="columns()" [rows]="rows()" [exportName]="active()" [canExport]="auth.can('reports','export')" (rowClick)="open($event)">
          @if (active() === 'monthly-service') {
            <label class="small" style="display:inline-flex; align-items:center; gap:6px">เดือน
              <input type="month" [value]="month()" (change)="setMonth($event)" aria-label="เดือนของรายงาน" />
            </label>
          }
          @if (active() === 'monthly-service' || active() === 'revenue-share' || active() === 'service-contracts') {
            <button type="button" class="btn tool" (click)="downloadPdf()">พิมพ์ PDF</button>
          }
        </app-data-table>
      }
    </div>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ReportsComponent implements OnInit {
  readonly auth = inject(AuthService);
  private readonly api = inject(ApiService);
  private readonly toast = inject(ToastService);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);

  readonly active = signal<ReportName>('tickets');
  readonly rows = signal<RecordRow[]>([]);
  readonly loading = signal(false);
  readonly error = signal('');
  readonly month = signal(new Date().toISOString().slice(0, 7));
  private readonly tabDefs: { name: ReportName; label: string; resource: string }[] = [
    { name: 'tickets', label: 'Ticket ทั้งหมด', resource: 'tickets' },
    { name: 'projects', label: 'โครงการ', resource: 'projects' },
    { name: 'service-contracts', label: 'สัญญาบริการ', resource: 'projects' },
    { name: 'revenue-share', label: 'ส่วนแบ่งรายได้', resource: 'projects' },
    { name: 'monthly-service', label: 'บริการรายเดือน', resource: 'tickets' },
    { name: 'boq', label: 'BOQ เทียบจริง', resource: 'projects' },
    { name: 'serials', label: 'Serial/รับประกัน', resource: 'assets' },
    { name: 'stock', label: 'ยอดสต็อก', resource: 'warehouse' },
  ];
  readonly tabs = computed<[ReportName, string][]>(() =>
    this.tabDefs.filter((tab) => this.auth.can(tab.resource, 'view')).map((tab) => [tab.name, tab.label]),
  );
  readonly fmtDate = fmtDate;
  readonly fmtDuration = fmtDuration;
  readonly fmtMoney = fmtMoney;

  ngOnInit(): void {
    const allowed = this.tabs();
    const requested = this.route.snapshot.queryParamMap.get('report') as ReportName | null;
    if (requested && allowed.some(([name]) => name === requested)) this.active.set(requested);
    else if (allowed.length && !allowed.some(([name]) => name === this.active())) this.active.set(allowed[0][0]);
    this.load();
  }

  select(name: ReportName): void {
    if (!this.tabs().some(([key]) => key === name)) return;
    this.active.set(name);
    this.load();
  }

  load(): void {
    this.error.set('');
    if (!this.tabs().length) {
      this.rows.set([]);
      return;
    }
    this.loading.set(true);
    const path = this.active() === 'monthly-service'
      ? `/reports/monthly-service?month=${encodeURIComponent(this.month())}`
      : `/reports/${this.active()}`;
    this.api.get<RecordRow[]>(path).subscribe({
      next: (rows) => {
        this.rows.set(rows);
        this.loading.set(false);
      },
      error: (error: unknown) => {
        this.loading.set(false);
        this.error.set(apiErrorMessage(error));
      },
    });
  }

  setMonth(event: Event): void {
    this.month.set((event.target as HTMLInputElement).value || new Date().toISOString().slice(0, 7));
    this.load();
  }

  /** ดาวน์โหลดรายงานปัจจุบันเป็น PDF (สร้างฝั่งเซิร์ฟเวอร์ด้วย headless browser) */
  downloadPdf(): void {
    const query = this.active() === 'monthly-service' ? `?month=${encodeURIComponent(this.month())}` : '';
    const name = this.active() === 'monthly-service' ? `monthly-service-${this.month()}` : this.active();
    this.api.blob(`/reports/${this.active()}/pdf${query}`).subscribe({
      next: (blob) => {
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = `${name}.pdf`;
        document.body.appendChild(link);
        link.click();
        link.remove();
        setTimeout(() => URL.revokeObjectURL(url), 3000);
        this.toast.show('สร้าง PDF แล้ว');
      },
      error: (error: unknown) => this.toast.error(apiErrorMessage(error)),
    });
  }

  columns(): ColumnDef[] {
    switch (this.active()) {
      case 'tickets':
        return [
          { key: 'code', label: 'เลขที่' },
          { key: 'title', label: 'หัวข้อ' },
          { key: 'customer', label: 'ลูกค้า', value: (row) => row._labels?.['customer'] ?? '–' },
          { key: 'site', label: 'ไซต์', value: (row) => row._labels?.['site'] ?? '–' },
          { key: 'statusLabel', label: 'สถานะ' },
          { key: 'team', label: 'ทีม' },
          { key: 'assignee', label: 'ผู้รับผิดชอบ', value: (row) => row._labels?.['assignee'] ?? '–' },
          { key: 'responseH', label: 'ตอบสนอง', value: (row) => fmtDuration(row['responseH'] as number) },
          { key: 'ageH', label: 'อายุเคส/ใช้เวลา', value: (row) => fmtDuration(row['ageH'] as number) },
        ];
      case 'projects':
        return [
          { key: 'code', label: 'รหัส' }, { key: 'name', label: 'โครงการ' },
          { key: 'customer', label: 'ลูกค้า', value: (row) => row._labels?.['customer'] ?? '–' },
          { key: 'manager', label: 'ผู้จัดการ', value: (row) => row._labels?.['manager'] ?? '–' },
          { key: 'track', label: 'เส้นทาง' },
          { key: 'partner', label: 'คู่สัญญา' },
          { key: 'stepLabel', label: 'ขั้นตอนปัจจุบัน/สถานะ' },
          { key: 'done', label: 'ขั้นตอนที่เสร็จ' },
          { key: 'value', label: 'มูลค่า', value: (row) => fmtMoney(row['value']) },
        ];
      case 'service-contracts':
        return [
          { key: 'code', label: 'รหัส' }, { key: 'name', label: 'โครงการ' },
          { key: 'customer', label: 'ลูกค้า', value: (row) => row._labels?.['customer'] ?? '–' },
          { key: 'svcContract', label: 'เลขที่สัญญาบริการ' },
          { key: 'svcStart', label: 'เริ่ม', value: (row) => fmtDate(row['svcStart']) },
          { key: 'svcEnd', label: 'สิ้นสุด', value: (row) => fmtDate(row['svcEnd']) },
          { key: 'svcDays', label: 'เหลือ (วัน)' },
          { key: 'serviceStatus', label: 'สถานะ', badge: (row) => row['serviceStatus'] === 'หมดสัญญา' ? 'red' : row['serviceStatus'] === 'ใกล้หมด' ? 'amber' : 'green' },
          { key: 'sharePercent', label: 'ส่วนแบ่ง SJP (%)' },
        ];
      case 'revenue-share':
        return [
          { key: 'code', label: 'รหัส' }, { key: 'name', label: 'โครงการ' },
          { key: 'partner', label: 'คู่สัญญา' },
          { key: 'sharePercent', label: 'ส่วนแบ่ง SJP (%)' },
          { key: 'value', label: 'มูลค่าสัญญา', value: (row) => fmtMoney(row['value']) },
          { key: 'invoiced', label: 'ออกใบแจ้งหนี้', value: (row) => fmtMoney(row['invoiced']) },
          { key: 'received', label: 'รับชำระแล้ว', value: (row) => fmtMoney(row['received']) },
          { key: 'sjpShare', label: 'ส่วน SJP', value: (row) => fmtMoney(row['sjpShare']) },
          { key: 'partnerShare', label: 'ส่วนพาร์ตเนอร์', value: (row) => fmtMoney(row['partnerShare']) },
        ];
      case 'monthly-service':
        return [
          { key: 'projectCode', label: 'รหัส' }, { key: 'projectName', label: 'โครงการ' },
          { key: 'opened', label: 'เคสเปิดใหม่' },
          { key: 'closed', label: 'ปิดในเดือน' },
          { key: 'urgent', label: 'เร่งด่วน/สูง' },
          { key: 'avgResponse', label: 'ตอบสนองเฉลี่ย (ชม.)', value: (row) => row['avgResponse'] ?? '–' },
          { key: 'avgResolve', label: 'แก้ไขเฉลี่ย (ชม.)', value: (row) => row['avgResolve'] ?? '–' },
          { key: 'pmDue', label: 'PM ครบกำหนด' },
          { key: 'pmDone', label: 'PM เสร็จ' },
        ];
      case 'boq':
        return [
          { key: 'projectCode', label: 'โครงการ' },
          { key: 'itemLabel', label: 'สินค้า' },
          { key: 'qty', label: 'ต้องใช้' }, { key: 'ordered', label: 'สั่งซื้อ' }, { key: 'received', label: 'รับเข้า' }, { key: 'issued', label: 'เบิกไปหน้างาน' }, { key: 'installed', label: 'ติดตั้งแล้ว' },
        ];
      case 'serials':
        return [
          { key: 'serialNo', label: 'Serial' },
          { key: 'item', label: 'สินค้า', value: (row) => row._labels?.['item'] ?? '–' },
          { key: 'status', label: 'สถานะ' },
          { key: 'site', label: 'ไซต์', value: (row) => row._labels?.['site'] ?? '–' },
          { key: 'location', label: 'จุดติดตั้ง' },
          { key: 'installedDate', label: 'ติดตั้ง', value: (row) => fmtDate(row['installedDate']) },
          { key: 'warrantyEnd', label: 'รับประกันถึง', value: (row) => fmtDate(row['warrantyEnd']) },
          { key: 'warranty', label: 'สถานะประกัน', badge: (row) => row['warranty'] === 'หมดประกัน' ? 'red' : row['warranty'] === 'ใกล้หมด' ? 'amber' : 'green' },
        ];
      default:
        return [
          { key: 'sku', label: 'SKU' }, { key: 'name', label: 'สินค้า' },
          { key: 'total', label: 'คงเหลือรวม' },
          { key: 'minStock', label: 'ขั้นต่ำ' },
        ];
    }
  }

  open(row: Record<string, unknown>): void {
    if (this.active() === 'tickets') void this.router.navigate(['/tickets', String(row['id'])]);
    if (this.active() === 'projects' || this.active() === 'service-contracts' || this.active() === 'revenue-share') {
      void this.router.navigate(['/projects', String(row['id'])]);
    }
    if (this.active() === 'monthly-service' && row['id'] && !String(row['id']).startsWith('(')) {
      void this.router.navigate(['/projects', String(row['id'])]);
    }
    if (this.active() === 'serials') void this.router.navigate(['/entities/serials', String(row['id'])]);
    if (this.active() === 'boq' && row['projectId']) void this.router.navigate(['/projects', String(row['projectId'])]);
  }
}
