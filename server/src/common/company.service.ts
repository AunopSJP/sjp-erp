import { InjectDrizzle } from '@nestjs/drizzle';
import { Injectable } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import type { Db } from '../db/database.service.js';
import { settings } from '../db/schema.js';
import type { SafeUser } from '../auth/user.types.js';
import { AccessService } from './access.service.js';
import { AuditService } from './audit.service.js';
import { bad } from './exceptions.js';

const COMPANY_KEY = 'company';

export interface CompanyInfo {
  name: string;
  nameEn: string;
  taxId: string;
  address: string;
  phone: string;
  email: string;
  website: string;
  footerNote: string;
  /** Projects above this value on the government track must pass an ICT defence gate. */
  governmentBidThreshold: number;
  /** Alert and show ticket targets from the built-in, unconfirmed SLA numbers. */
  slaSampleAlerts: boolean;
}

const DEFAULT_COMPANY: CompanyInfo = {
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

@Injectable()
export class CompanyService {
  constructor(
    @InjectDrizzle() private readonly db: Db,
    private readonly access: AccessService,
    private readonly audit: AuditService,
  ) {}

  get(): CompanyInfo {
    const row = this.db.select().from(settings).where(eq(settings.key, COMPANY_KEY)).all()[0];
    const value = row?.value;
    if (!value || typeof value !== 'object' || Array.isArray(value)) return { ...DEFAULT_COMPANY };
    const merged = { ...DEFAULT_COMPANY, ...(value as Partial<CompanyInfo>) };
    const threshold = Number(merged.governmentBidThreshold);
    merged.governmentBidThreshold = Number.isFinite(threshold) && threshold >= 0 ? Math.round(threshold) : DEFAULT_COMPANY.governmentBidThreshold;
    merged.slaSampleAlerts = merged.slaSampleAlerts !== false;
    return merged;
  }

  save(user: SafeUser, input: Partial<CompanyInfo>): CompanyInfo {
    this.access.require(user, 'settings', 'edit');
    const current = this.get();
    const rawThreshold = Number(input.governmentBidThreshold ?? current.governmentBidThreshold);
    if (!Number.isFinite(rawThreshold) || rawThreshold < 0) bad('เกณฑ์มูลค่าโครงการราชการไม่ถูกต้อง');
    const slaSampleAlerts: unknown = input.slaSampleAlerts ?? current.slaSampleAlerts;
    if (typeof slaSampleAlerts !== 'boolean') bad('ค่าการเตือน SLA ไม่ถูกต้อง');
    const next: CompanyInfo = {
      name: String(input.name ?? '').trim().slice(0, 120) || 'SJP ERP',
      nameEn: String(input.nameEn ?? '').trim().slice(0, 160),
      taxId: String(input.taxId ?? '').trim().slice(0, 40),
      address: String(input.address ?? '').trim().slice(0, 500),
      phone: String(input.phone ?? '').trim().slice(0, 80),
      email: String(input.email ?? '').trim().slice(0, 160),
      website: String(input.website ?? '').trim().slice(0, 160),
      footerNote: String(input.footerNote ?? '').trim().slice(0, 300),
      governmentBidThreshold: Math.round(rawThreshold),
      slaSampleAlerts,
    };
    if (next.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(next.email)) bad('อีเมลบริษัทไม่ถูกต้อง');
    const row = this.db.select().from(settings).where(eq(settings.key, COMPANY_KEY)).all()[0];
    if (row) this.db.update(settings).set({ value: next }).where(eq(settings.key, COMPANY_KEY)).run();
    else this.db.insert(settings).values({ key: COMPANY_KEY, value: next }).run();
    this.audit.log(user, { action: 'metadata', entity: 'settings', summary: 'แก้ไขข้อมูลบริษัท/หัวเอกสาร' });
    if (slaSampleAlerts !== current.slaSampleAlerts) {
      this.audit.log(user, { action: 'metadata', entity: 'settings', summary: `${slaSampleAlerts ? 'เปิด' : 'ปิด'}การเตือน SLA จากตัวเลขตัวอย่าง` });
    }
    return next;
  }
}
