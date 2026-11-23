import { ChangeDetectionStrategy, Component, OnDestroy, OnInit, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { ApiService, apiErrorMessage } from '../core/api.service';
import { AuthService } from '../core/auth.service';
import { fmtDateTime, fmtDuration } from '../core/util';
import { IconComponent } from '../shared/icon.component';
import { StateComponent } from '../shared/state.component';
import { ToastService } from '../shared/toast.service';
import type { DashboardData } from '../core/dashboard.models';
import type { RecordRow } from '../core/models';

interface FocusItem {
  key: string;
  label: string;
  count: number;
  tone: 'red' | 'amber' | 'blue';
  link: string;
}

@Component({
  selector: 'app-dashboard',
  standalone: true,
  imports: [RouterLink, IconComponent, StateComponent],
  template: `
    <div class="page dash">
      <header class="dash-top">
        <div>
          <div class="dash-kicker">ศูนย์ปฏิบัติการ · {{ todayText }}</div>
          <h1>ภาพรวมปฏิบัติการ</h1>
          <p class="dash-sub">{{ greeting }}, {{ firstName }} — งานที่ต้องตัดสินใจและติดตามวันนี้</p>
        </div>
        <div class="page-actions">
          <a class="btn" routerLink="/workspace" [queryParams]="{ edit: 1 }"><app-icon name="grid" [size]="14" /> จัดหน้าจอ</a>
          <a class="btn" routerLink="/projects"><app-icon name="folder" [size]="14" /> โครงการ</a>
          <a class="btn" routerLink="/calendar"><app-icon name="calendar" [size]="14" /> ปฏิทินงาน</a>
          <a class="btn ghost" routerLink="/my"><app-icon name="check" [size]="14" /> งานของฉัน</a>
          @if (lastLoaded(); as at) {
            <span class="dash-updated muted small" aria-live="polite" title="รีเฟรชอัตโนมัติทุก 60 วินาทีขณะเปิดหน้านี้"><span class="live-dot" aria-hidden="true"></span>อัปเดต {{ fmtTime(at) }}</span>
          }
          <button type="button" class="btn ghost" [disabled]="refreshing()" (click)="load(true)">
            <app-icon name="refresh" [size]="14" /> {{ refreshing() ? 'กำลังอัปเดต…' : 'รีเฟรช' }}
          </button>
        </div>
      </header>

      @if (loading()) {
        <app-state kind="loading" message="กำลังโหลดข้อมูล…" />
      } @else if (data()) {
        <section class="dash-focus" aria-label="สิ่งที่ต้องให้ความสนใจ">
          <span class="dash-focus-title">โฟกัสวันนี้</span>
          @if (!focusItems().length) {
            <span class="focus-none">ทุกอย่างอยู่ในเกณฑ์ — ไม่มีรายการค้างที่ต้องตัดสินใจ</span>
          } @else {
            @for (item of focusItems(); track item.key) {
              <a class="focus-chip {{ item.tone }}" [routerLink]="item.link">
                <span class="focus-dot" aria-hidden="true"></span>
                <b>{{ item.count }}</b>
                <span>{{ item.label }}</span>
              </a>
            }
          }
        </section>
        <section class="dash-kpis" aria-label="ตัวชี้วัดสำคัญ">
          @if (auth.can('tickets', 'view') || auth.can('pm', 'view') || auth.can('projects', 'view')) {
            <a class="dash-kpi" routerLink="/my">
              <span class="dash-kpi-label"><app-icon name="check" [size]="13" /> งานของฉัน</span>
              <span class="dash-kpi-value">{{ data()!.tickets.mine }}</span>
              <span class="dash-kpi-meta">เคสที่มอบหมายให้คุณ</span>
            </a>
          }
          @if (auth.can('tickets', 'view') || auth.can('purchase', 'view') || auth.can('accounting', 'view')) {
            <a class="dash-kpi" [class.alert]="data()!.pendingApprovals > 0" routerLink="/approvals">
              <span class="dash-kpi-label"><app-icon name="bell" [size]="13" /> รออนุมัติ</span>
              <span class="dash-kpi-value">{{ data()!.pendingApprovals }}</span>
              <span class="dash-kpi-meta">คำขอที่ยังไม่ตัดสินใจ</span>
            </a>
          }
          @if (auth.can('tickets', 'view')) {
            <a class="dash-kpi" [class.alert]="data()!.tickets.urgent > 0" routerLink="/tickets">
              <span class="dash-kpi-label"><app-icon name="ticket" [size]="13" /> เคสค้าง</span>
              <span class="dash-kpi-value">{{ data()!.tickets.open }}</span>
              <span class="dash-kpi-meta">{{ data()!.tickets.urgent ? data()!.tickets.urgent + ' เคสสูง/เร่งด่วน' : 'ไม่มีเคสเร่งด่วน' }}</span>
            </a>
          }
          @if (auth.can('pm', 'view')) {
            <a class="dash-kpi" [class.alert]="data()!.pm.overdue > 0" routerLink="/pm">
              <span class="dash-kpi-label"><app-icon name="wrench" [size]="13" /> PM เกินกำหนด</span>
              <span class="dash-kpi-value">{{ data()!.pm.overdue }}</span>
              <span class="dash-kpi-meta">แผนงานในสัปดาห์นี้ {{ data()!.pm.week }}</span>
            </a>
          }
          @if (auth.can('warehouse', 'view')) {
            <a class="dash-kpi" [class.alert]="data()!.stock.low > 0" routerLink="/warehouse">
              <span class="dash-kpi-label"><app-icon name="box" [size]="13" /> สินค้าต่ำ</span>
              <span class="dash-kpi-value">{{ data()!.stock.low }}</span>
              <span class="dash-kpi-meta">{{ stockMeta() }}</span>
            </a>
          }
          @if (auth.can('assets', 'view')) {
            <a class="dash-kpi" routerLink="/entities/serials">
              <span class="dash-kpi-label"><app-icon name="tag" [size]="13" /> ใกล้หมดประกัน</span>
              <span class="dash-kpi-value">{{ data()!.warranty }}</span>
              <span class="dash-kpi-meta">อุปกรณ์ภายใน 30 วัน</span>
            </a>
          }
        </section>

        <div class="dash-layout" [class.single]="!auth.can('tickets', 'view')">
          @if (auth.can('tickets', 'view')) {
            <section class="panel">
              <div class="panel-head">
                <h2>คิวงานที่ต้องจัดการ</h2>
                <span class="badge gray">{{ data()!.oldest.length }}</span>
                <a class="link" routerLink="/tickets">ดูทั้งหมด</a>
              </div>
            <div class="panel-body">
              @if (!data()!.oldest.length) {
                <div class="panel-empty">ไม่มีเคสค้าง — เยี่ยมมาก</div>
              } @else {
                @for (ticket of data()!.oldest; track ticket.id) {
                  <a class="queue-row" [routerLink]="['/tickets', ticket.id]">
                    <span class="queue-code">{{ ticket.code }}</span>
                    <span class="queue-main">
                      <b>{{ ticket['title'] }}</b>
                      <span>{{ ticket._labels?.['site'] }} · {{ ticket._labels?.['assignee'] || 'ยังไม่มอบหมาย' }}</span>
                    </span>
                    <span class="queue-age">{{ fmtDuration(ticket.ageH) }}</span>
                  </a>
                }
              }
            </div>
          </section>
          }

          <section class="panel">
            <div class="panel-head">
              <h2>ความเคลื่อนไหวล่าสุด</h2>
              @if (auth.can('settings', 'view')) {
                <a class="link" routerLink="/settings">ทั้งหมด</a>
              }
            </div>
            <div class="panel-body">
              @if (!data()!.activity.length) {
                <div class="panel-empty">ยังไม่มีความเคลื่อนไหว</div>
              } @else {
                @for (entry of data()!.activity; track entry.id) {
                  <div class="activity-row">
                    <span class="act-avatar">{{ entry.userName.charAt(0) }}</span>
                    <span class="act-main">{{ entry.summary }}<span>{{ entry.userName }}</span></span>
                    <span class="act-time">{{ fmtDateTime(entry.at) }}</span>
                  </div>
                }
              }
            </div>
          </section>
        </div>

        @if (auth.can('accounting', 'view') && data()!.finance; as fin) {
          <section class="panel finance-panel">
            <div class="panel-head">
              <h2>ภาพรวมการเงิน</h2>
              <a class="link" routerLink="/entities/invoices">ดูใบแจ้งหนี้ทั้งหมด</a>
            </div>
            <div class="finance-strip">
              <a class="fin-item" routerLink="/entities/invoices">
                <div class="fin-label">ยอดค้างชำระ</div>
                <div class="fin-value">{{ money(fin.invoices.outstanding) }}</div>
                <div class="fin-meta">{{ fin.invoices.open }} ใบ · ครบใน 7 วัน {{ fin.invoices.dueSoon }} ใบ</div>
              </a>
              <a class="fin-item" routerLink="/entities/invoices">
                <div class="fin-label">ใบแจ้งหนี้เกินกำหนด</div>
                <div class="fin-value" [class.alert]="fin.invoices.overdue > 0">{{ fin.invoices.overdue }}</div>
                <div class="fin-meta">รวม {{ money(fin.invoices.overdueAmount) }}</div>
              </a>
              <a class="fin-item" routerLink="/entities/receipts">
                <div class="fin-label">รับชำระเดือนนี้</div>
                <div class="fin-value">{{ money(fin.receipts.month) }}</div>
                <div class="fin-meta">{{ fin.receipts.count }} รายการ</div>
              </a>
              <a class="fin-item" routerLink="/entities/expenses">
                <div class="fin-label">ค่าใช้จ่ายเดือนนี้</div>
                <div class="fin-value">{{ money(fin.expenses.month) }}</div>
                <div class="fin-meta">รออนุมัติ {{ fin.expenses.pending }} รายการ</div>
              </a>
            </div>
          </section>
        }

        @if (auth.can('tickets', 'view') || auth.can('projects', 'view')) {
        <div class="dash-grid">
          @if (auth.can('tickets', 'view')) {
          <section class="panel">
            <div class="panel-head"><h2>เคสตามสถานะ</h2></div>
            <div class="panel-body">
              @if (!data()!.byStatus.length) {
                <div class="panel-empty">ไม่มีเคสค้าง</div>
              } @else {
                @for (row of data()!.byStatus; track row.key) {
                  <div class="bar-row">
                    <span class="bar-label">{{ row.label }}</span>
                    <span class="bar-track"><span class="bar-fill" [style.width.%]="barWidth(row.count, maxStatus())"></span></span>
                    <span class="bar-count">{{ row.count }}</span>
                  </div>
                }
              }
            </div>
          </section>

          <section class="panel">
            <div class="panel-head"><h2>เคสตามทีม</h2></div>
            <div class="panel-body">
              @if (!data()!.byTeam.length) {
                <div class="panel-empty">ไม่มีเคสค้าง</div>
              } @else {
                @for (row of data()!.byTeam; track row.label) {
                  <div class="bar-row">
                    <span class="bar-label">{{ row.label }}</span>
                    <span class="bar-track"><span class="bar-fill" [style.width.%]="barWidth(row.count, maxTeam())"></span></span>
                    <span class="bar-count">{{ row.count }}</span>
                  </div>
                }
              }
            </div>
          </section>

          <section class="panel">
            <div class="panel-head"><h2>เคสตามผู้รับผิดชอบ</h2></div>
            <div class="panel-body">
              @if (!data()!.byAssignee.length) {
                <div class="panel-empty">ไม่มีเคสค้าง</div>
              } @else {
                @for (row of data()!.byAssignee; track row.id) {
                  <div class="bar-row">
                    <span class="bar-label">{{ row.label }}</span>
                    <span class="bar-track"><span class="bar-fill" [style.width.%]="barWidth(row.count, maxAssignee())"></span></span>
                    <span class="bar-count">{{ row.count }}</span>
                  </div>
                }
              }
            </div>
          </section>
          }

          @if (auth.can('projects', 'view')) {
          <section class="panel">
            <div class="panel-head"><h2>โครงการตามขั้นตอน</h2></div>
            <div class="panel-body">
              @if (!projectSteps().length) {
                <div class="panel-empty">ไม่มีโครงการที่ดำเนินการ</div>
              } @else {
                @for (row of projectSteps(); track row[0]) {
                  <div class="bar-row">
                    <span class="bar-label">{{ row[0] }}</span>
                    <span class="bar-track"><span class="bar-fill" [style.width.%]="barWidth(row[1], maxStep())"></span></span>
                    <span class="bar-count">{{ row[1] }}</span>
                  </div>
                }
              }
            </div>
          </section>
          }
        </div>
        }
      }
    </div>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DashboardComponent implements OnInit, OnDestroy {
  readonly auth = inject(AuthService);
  private readonly api = inject(ApiService);
  private readonly toast = inject(ToastService);

  readonly loading = signal(true);
  readonly refreshing = signal(false);
  readonly lastLoaded = signal<Date | null>(null);
  readonly data = signal<DashboardData | null>(null);
  readonly fmtDuration = fmtDuration;
  readonly fmtDateTime = fmtDateTime;
  readonly stockMeta = computed(() => {
    const stock = this.data()?.stock;
    if (!stock) return '';
    if (!stock.names.length) return 'สต็อกอยู่ในระดับปกติ';
    const joined = stock.names.join(', ');
    return joined.length > 42 ? `สินค้าต่ำ ${stock.low} รายการ` : joined;
  });

  readonly focusItems = computed<FocusItem[]>(() => {
    const data = this.data();
    if (!data) return [];
    const items: FocusItem[] = [];
    if (this.auth.can('tickets', 'view') && data.tickets.urgent > 0) {
      items.push({ key: 'urgent', label: 'เคสเร่งด่วน', count: data.tickets.urgent, tone: 'red', link: '/tickets' });
    }
    if (data.pendingApprovals > 0) {
      items.push({ key: 'approvals', label: 'รออนุมัติ', count: data.pendingApprovals, tone: 'amber', link: '/approvals' });
    }
    if (this.auth.can('pm', 'view') && data.pm.overdue > 0) {
      items.push({ key: 'pm', label: 'PM เกินกำหนด', count: data.pm.overdue, tone: 'amber', link: '/pm' });
    }
    if (this.auth.can('accounting', 'view') && (data.finance?.invoices.overdue ?? 0) > 0) {
      items.push({ key: 'invoices', label: 'ใบแจ้งหนี้เกินกำหนด', count: data.finance!.invoices.overdue, tone: 'red', link: '/entities/invoices' });
    }
    if (this.auth.can('accounting', 'view') && (data.finance?.expenses.pending ?? 0) > 0) {
      items.push({ key: 'expenses', label: 'ค่าใช้จ่ายรออนุมัติ', count: data.finance!.expenses.pending, tone: 'amber', link: '/entities/expenses' });
    }
    if (this.auth.can('warehouse', 'view') && data.stock.low > 0) {
      items.push({ key: 'stock', label: 'สินค้าใกล้หมด', count: data.stock.low, tone: 'blue', link: '/warehouse' });
    }
    if (this.auth.can('projects', 'view') && (data.contracts?.expired ?? 0) > 0) {
      items.push({ key: 'svc-expired', label: 'สัญญาบริการหมดอายุ', count: data.contracts.expired, tone: 'red', link: '/reports?report=service-contracts' });
    }
    if (this.auth.can('projects', 'view') && (data.contracts?.expiring ?? 0) > 0) {
      items.push({ key: 'svc-expiring', label: 'สัญญาบริการใกล้หมด (60 วัน)', count: data.contracts.expiring, tone: 'amber', link: '/reports?report=service-contracts' });
    }
    return items;
  });

  money(value: unknown): string {
    const n = Number(value);
    return new Intl.NumberFormat('th-TH', { maximumFractionDigits: 0 }).format(Number.isFinite(n) ? n : 0);
  }

  get firstName(): string {
    return (this.auth.user()?.name ?? '').replace(/\s*\(.*\)/, '');
  }

  get greeting(): string {
    const h = new Date().getHours();
    return h < 12 ? 'สวัสดีตอนเช้า' : h < 17 ? 'สวัสดีตอนบ่าย' : 'สวัสดีตอนเย็น';
  }

  get todayText(): string {
    return new Intl.DateTimeFormat('th-TH', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }).format(new Date());
  }

  ngOnInit(): void {
    this.load();
    this.timer = setInterval(this.tick, 60_000);
    document.addEventListener('visibilitychange', this.onVisibility);
  }

  ngOnDestroy(): void {
    if (this.timer) clearInterval(this.timer);
    document.removeEventListener('visibilitychange', this.onVisibility);
  }

  private timer: ReturnType<typeof setInterval> | null = null;

  /** Background refresh only while the tab is visible and no request is running. */
  private readonly tick = (): void => {
    if (document.visibilityState !== 'visible' || this.refreshing()) return;
    this.load(true, true);
  };

  private readonly onVisibility = (): void => {
    if (document.visibilityState === 'visible' && !this.refreshing()) this.load(true, true);
  };

  /**
   * `silent` keeps the current numbers on screen while refreshing; `quiet`
   * suppresses error toasts for the automatic background refresh.
   */
  load(silent = false, quiet = false): void {
    if (silent) this.refreshing.set(true);
    else this.loading.set(true);
    this.api.get<DashboardData>('/dashboard').subscribe({
      next: (data) => {
        this.data.set(data);
        this.lastLoaded.set(new Date());
        this.loading.set(false);
        this.refreshing.set(false);
      },
      error: (error: unknown) => {
        this.loading.set(false);
        this.refreshing.set(false);
        if (!quiet) this.toast.error(apiErrorMessage(error));
      },
    });
  }

  fmtTime(value: Date): string {
    return new Intl.DateTimeFormat('th-TH', { hour: '2-digit', minute: '2-digit', second: '2-digit' }).format(value);
  }

  projectSteps(): [string, number][] {
    return Object.entries(this.data()?.projects.byStep ?? {}).sort((a, b) => b[1] - a[1]);
  }

  maxStatus(): number {
    return Math.max(1, ...(this.data()?.byStatus ?? []).map((row) => row.count));
  }

  maxTeam(): number {
    return Math.max(1, ...(this.data()?.byTeam ?? []).map((row) => row.count));
  }

  maxAssignee(): number {
    return Math.max(1, ...(this.data()?.byAssignee ?? []).map((row) => row.count));
  }

  maxStep(): number {
    return Math.max(1, ...this.projectSteps().map((row) => row[1]));
  }

  barWidth(value: number, max: number): number {
    return Math.min(100, (value / Math.max(1, max)) * 100);
  }
}
