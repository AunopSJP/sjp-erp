import { ChangeDetectionStrategy, Component, OnInit, inject, signal } from '@angular/core';
import { ApiService, apiErrorMessage } from '../core/api.service';
import { AuthService } from '../core/auth.service';
import { MetaService } from '../core/meta.service';
import { ToastService } from '../shared/toast.service';

interface CompanyInfo {
  name: string;
  nameEn: string;
  taxId: string;
  address: string;
  phone: string;
  email: string;
  website: string;
  footerNote: string;
  governmentBidThreshold: number;
  slaSampleAlerts: boolean;
}

const EMPTY: CompanyInfo = {
  name: 'SJP ERP',
  nameEn: '',
  taxId: '',
  address: '',
  phone: '',
  email: '',
  website: '',
  footerNote: '',
  governmentBidThreshold: 500_000,
  slaSampleAlerts: true,
};

@Component({
  selector: 'app-company-settings',
  standalone: true,
  template: `
    <div class="card">
      <div class="row" style="margin-bottom:10px">
        <div>
          <h3 style="margin:0">ข้อมูลบริษัท / หัวเอกสาร</h3>
          <div class="muted small">ข้อมูลนี้จะแสดงบนหัวและท้ายเอกสาร PDF ทุกประเภท</div>
        </div>
        <span class="grow"></span>
        <button type="button" class="btn primary" [disabled]="busy() || !loaded() || !auth.can('settings','edit')" (click)="save()">{{ busy() ? 'กำลังบันทึก…' : 'บันทึกข้อมูล' }}</button>
      </div>

      <div class="form-grid">
        <div class="field"><label for="lf-company-settings-component-1">ชื่อบริษัท (ไทย) *</label><input id="lf-company-settings-component-1" [value]="company().name" (input)="set('name', $any($event.target).value)" /></div>
        <div class="field"><label for="lf-company-settings-component-2">ชื่อบริษัท (EN)</label><input id="lf-company-settings-component-2" [value]="company().nameEn" (input)="set('nameEn', $any($event.target).value)" /></div>
        <div class="field"><label for="lf-company-settings-component-3">เลขประจำตัวผู้เสียภาษี</label><input id="lf-company-settings-component-3" [value]="company().taxId" (input)="set('taxId', $any($event.target).value)" /></div>
        <div class="field"><label for="lf-company-settings-component-4">โทรศัพท์</label><input id="lf-company-settings-component-4" [value]="company().phone" (input)="set('phone', $any($event.target).value)" /></div>
        <div class="field"><label for="lf-company-settings-component-5">อีเมล</label><input id="lf-company-settings-component-5" [value]="company().email" (input)="set('email', $any($event.target).value)" /></div>
        <div class="field"><label for="lf-company-settings-component-6">เว็บไซต์</label><input id="lf-company-settings-component-6" [value]="company().website" (input)="set('website', $any($event.target).value)" /></div>
        <div class="field wide"><label for="lf-company-settings-component-7">ที่อยู่</label><textarea id="lf-company-settings-component-7" rows="3" [value]="company().address" (input)="set('address', $any($event.target).value)"></textarea></div>
        <div class="field wide"><label for="lf-company-settings-component-8">หมายเหตุท้ายเอกสาร (เช่น เงื่อนไขชำระ)</label><textarea id="lf-company-settings-component-8" rows="3" [value]="company().footerNote" (input)="set('footerNote', $any($event.target).value)"></textarea></div>
        <div class="field">
          <label for="lf-company-settings-component-9">เกณฑ์มูลค่า defended ICT (บาท)</label>
          <input id="lf-company-settings-component-9" type="number" min="0" [value]="company().governmentBidThreshold" (input)="set('governmentBidThreshold', +$any($event.target).value)" />
          <div class="muted small" style="margin-top:4px">โครงการราชการที่มูลค่าเกินเกณฑ์นี้ต้องบันทึกผล defended ICT = ผ่าน ก่อนจบขั้นเสนอ</div>
        </div>
        <div class="field">
          <label class="row" for="lf-company-settings-component-10">
            <input id="lf-company-settings-component-10" type="checkbox" [checked]="company().slaSampleAlerts" (change)="set('slaSampleAlerts', $any($event.target).checked)" />
            เตือน SLA จากตัวเลขตัวอย่าง
          </label>
          <div class="muted small" style="margin-top:4px">เป้าเวลาตามความเร่งด่วน (4/8/24/72 ชม.) ยังไม่ได้ยืนยันว่าเป็นข้อตกลงจริง เมื่อปิด ระบบจะไม่เตือนเกิน SLA และหน้า Ticket จะแสดงเฉพาะอายุเคส</div>
        </div>
      </div>
      @if (message()) { <div class="notice" [class.bad]="error()" style="margin-top:12px">{{ message() }}</div> }
    </div>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CompanySettingsComponent implements OnInit {
  readonly auth = inject(AuthService);
  private readonly api = inject(ApiService);
  private readonly meta = inject(MetaService);
  private readonly toast = inject(ToastService);

  readonly company = signal<CompanyInfo>({ ...EMPTY });
  readonly busy = signal(false);
  /** Saving sends the whole form, so it waits for the stored values. */
  readonly loaded = signal(false);
  readonly message = signal('');
  readonly error = signal(false);

  ngOnInit(): void {
    this.api.get<CompanyInfo>('/company').subscribe({
      next: (company) => {
        this.company.set({ ...EMPTY, ...company });
        this.loaded.set(true);
      },
      error: (error: unknown) => this.toast.error(apiErrorMessage(error)),
    });
  }

  set<K extends keyof CompanyInfo>(key: K, value: CompanyInfo[K]): void {
    this.company.update((company) => ({ ...company, [key]: value }));
  }

  save(): void {
    if (this.busy() || !this.loaded() || !this.auth.can('settings','edit')) return;
    this.busy.set(true);
    this.message.set('');
    this.api.put<CompanyInfo>('/company', this.company()).subscribe({
      next: (company) => {
        this.busy.set(false);
        this.company.set({ ...EMPTY, ...company });
        // Field help depends on the company settings.
        this.meta.load(true);
        this.error.set(false);
        this.message.set('บันทึกข้อมูลบริษัทแล้ว — PDF ใหม่จะใช้ข้อมูลนี้');
        this.toast.show('บันทึกข้อมูลบริษัทแล้ว');
      },
      error: (error: unknown) => {
        this.busy.set(false);
        this.error.set(true);
        this.message.set(apiErrorMessage(error));
      },
    });
  }
}
