import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { execFile } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import type { SafeUser } from '../auth/user.types.js';
import { AccessService } from '../common/access.service.js';
import { CompanyService } from '../common/company.service.js';
import { fmtThaiDate, fmtThaiDateTime } from '../common/dates.js';
import { ENTITY_WORKFLOW_KEY, WORKFLOWS, type EntityDef, type FieldDef } from '../meta/entities.js';
import { RecordsService } from '../records/records.service.js';

const execFileAsync = promisify(execFile);

const escapeHtml = (value: unknown): string =>
  String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

const isMoney = (key: string): boolean => /amount|total|subtotal|vat|price|cost|salary/i.test(key);

/** ข้อมูลขั้นต่ำของรายงานที่ต้องการแปลงเป็น PDF */
export interface ReportPdfInput {
  title: string;
  subtitle?: string;
  columns: { label: string; align?: 'left' | 'right' }[];
  rows: string[][];
  summary?: { label: string; value: string }[];
  filename: string;
  userName: string;
}

const num = (value: unknown): string => {
  const n = Number(value);
  if (!Number.isFinite(n)) return escapeHtml(value);
  return new Intl.NumberFormat('th-TH', { maximumFractionDigits: 2 }).format(n);
};

@Injectable()
export class PdfService {
  private active = 0;
  private readonly waiters: Array<() => void> = [];

  constructor(
    private readonly records: RecordsService,
    private readonly access: AccessService,
    private readonly company: CompanyService,
  ) {}

  private async acquire(): Promise<void> {
    if (this.active < 2) {
      this.active++;
      return;
    }
    await new Promise<void>((resolve) => this.waiters.push(resolve));
    this.active++;
  }

  private release(): void {
    this.active = Math.max(0, this.active - 1);
    this.waiters.shift()?.();
  }

  async render(user: SafeUser, entityKey: string, id: string): Promise<{ buffer: Buffer; filename: string }> {
    const def = this.access.requireEntity(user, entityKey, 'view');
    const record = this.records.get(user, entityKey, id);
    const html = this.html(def, record as Record<string, unknown>, user);
    const safeCode = String(record.code ?? id).replace(/[^A-Za-z0-9._-]/g, '_');
    return this.renderHtml(html, `${safeCode}.pdf`);
  }

  /** สร้าง PDF จากรายงานตาราง (ใช้ร่วมกับรายงานบริการ/ส่วนแบ่งรายได้) */
  async renderReport(input: ReportPdfInput): Promise<{ buffer: Buffer; filename: string }> {
    return this.renderHtml(this.reportHtml(input), input.filename);
  }

  /** เรียก headless browser หนึ่งครั้งเพื่อพิมพ์ HTML เป็น PDF */
  private async renderHtml(html: string, filename: string): Promise<{ buffer: Buffer; filename: string }> {
    const dir = mkdtempSync(join(tmpdir(), 'sjp-pdf-'));
    const htmlPath = join(dir, 'document.html');
    const pdfPath = join(dir, 'document.pdf');
    const profile = join(dir, 'profile');
    const browser = this.browserPath();
    await this.acquire();
    try {
      writeFileSync(htmlPath, html, 'utf8');
      await execFileAsync(browser, [
        '--headless=new',
        '--disable-gpu',
        '--no-sandbox',
        '--disable-dev-shm-usage',
        '--no-first-run',
        '--no-default-browser-check',
        '--no-pdf-header-footer',
        '--print-to-pdf-no-header',
        `--user-data-dir=${profile}`,
        `--print-to-pdf=${pdfPath}`,
        pathToFileURL(htmlPath).href,
      ], { timeout: 45000, windowsHide: true });
      if (!existsSync(pdfPath)) throw new ServiceUnavailableException('สร้าง PDF ไม่สำเร็จ');
      const buffer = readFileSync(pdfPath);
      return { buffer, filename };
    } finally {
      this.release();
      rmSync(dir, { recursive: true, force: true });
    }
  }

  private browserPath(): string {
    const candidates = [
      process.env.PDF_BROWSER_PATH,
      'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
      'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
      'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
      'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
      '/usr/bin/google-chrome',
      '/usr/bin/chromium',
      '/usr/bin/chromium-browser',
      '/usr/bin/microsoft-edge',
      '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    ].filter((candidate): candidate is string => !!candidate);
    const found = candidates.find((candidate) => existsSync(candidate));
    if (!found) {
      throw new ServiceUnavailableException(
        'ไม่พบเบราว์เซอร์สำหรับสร้าง PDF — ตั้งค่า PDF_BROWSER_PATH ให้ชี้ไปที่ Chrome/Edge/Chromium',
      );
    }
    return found;
  }

  private html(def: EntityDef, row: Record<string, unknown>, user: SafeUser): string {
    const workflowKey = ENTITY_WORKFLOW_KEY[def.key] ?? def.key;
    const statuses = (WORKFLOWS as Record<string, { statuses?: { key: string; label: string }[] }>)[workflowKey]?.statuses ?? [];
    const status = statuses.find((item) => item.key === row['status']);
    const labels = (row['_labels'] ?? {}) as Record<string, string>;
    const rowLabels = (row['_rowLabels'] ?? {}) as Record<string, Array<Record<string, string>>>;
    const company = this.company.get();
    const companyMeta = [company.address, company.taxId ? `เลขประจำตัวผู้เสียภาษี ${company.taxId}` : '', company.phone, company.email, company.website]
      .filter(Boolean)
      .map((line) => escapeHtml(line))
      .join('<br>');

    const sections: string[] = [];
    const basic: string[] = [];
    for (const field of def.fields) {
      if (field.type === 'section' || field.type === 'formula' || field.hidden || field.sensitive) continue;
      if (field.type === 'rows') continue;
      basic.push(
        `<tr><th>${escapeHtml(field.label)}</th><td>${this.value(field, row[field.key], labels[field.key], true)}</td></tr>`,
      );
    }
    sections.push(`<table class="kv">${basic.join('')}</table>`);

    for (const field of def.fields) {
      if (field.type !== 'rows' || field.hidden) continue;
      const lines = Array.isArray(row[field.key]) ? (row[field.key] as Record<string, unknown>[]) : [];
      const cols = field.cols ?? [];
      const table = lines.length
        ? `<table class="grid"><thead><tr>${cols
            .map((col) => `<th>${escapeHtml(col.label)}</th>`)
            .join('')}</tr></thead><tbody>${lines
            .map(
              (line, index) =>
                `<tr>${cols
                  .map((col) => {
                    const label = rowLabels[field.key]?.[index]?.[col.key];
                    return `<td>${this.value(col, line[col.key], label, col.type === 'number' || isMoney(col.key))}</td>`;
                  })
                  .join('')}</tr>`,
            )
            .join('')}</tbody></table>`
        : `<div class="muted">ไม่มีรายการ</div>`;
      sections.push(`<h2>${escapeHtml(field.label)}</h2>${table}`);
    }

    const attachments = (row['attachments'] ?? []) as { name?: string }[];
    if (Array.isArray(attachments) && attachments.length) {
      sections.push(
        `<h2>ไฟล์แนบ</h2><ul>${attachments.map((file) => `<li>${escapeHtml(file.name ?? 'ไฟล์')}</li>`).join('')}</ul>`,
      );
    }

    return `<!doctype html>
<html lang="th">
<head>
<meta charset="utf-8" />
<title>${escapeHtml(def.label)} ${escapeHtml(row.code)}</title>
<style>
  @page { size: A4; margin: 14mm 14mm 16mm; }
  * { box-sizing: border-box; }
  body { margin: 0; color: #1f2328; font-family: "Leelawadee UI", "Tahoma", "Segoe UI", sans-serif; font-size: 12px; line-height: 1.55; }
  header { display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; border-bottom: 2px solid #dc2f36; padding-bottom: 10px; margin-bottom: 16px; }
  .brand { font-size: 22px; font-weight: 800; letter-spacing: .4px; color: #dc2f36; }
  .brand small { display: block; font-size: 10px; font-weight: 500; color: #6b6b6b; letter-spacing: 1px; }
  .company-meta { flex: 1; text-align: center; font-size: 10px; color: #666; line-height: 1.5; }
  .doc-note { margin-top: 22px; padding: 8px 10px; border: 1px solid #e5ded8; background: #faf7f4; font-size: 10px; color: #666; border-radius: 6px; }
  .doc-title { text-align: right; }
  .doc-title h1 { margin: 0 0 2px; font-size: 18px; }
  .doc-title .code { font-family: "Consolas", monospace; font-size: 13px; color: #444; }
  .badge { display: inline-block; padding: 2px 9px; border: 1px solid #bbb; border-radius: 99px; font-size: 11px; margin-top: 4px; }
  h2 { font-size: 13px; margin: 18px 0 6px; color: #333; }
  table { width: 100%; border-collapse: collapse; }
  table.kv th { width: 32%; text-align: left; font-weight: 500; color: #666; padding: 6px 10px; background: #faf7f4; border: 1px solid #e5ded8; }
  table.kv td { padding: 6px 10px; border: 1px solid #e5ded8; }
  table.grid th { background: #faf7f4; text-align: left; font-weight: 600; padding: 6px 8px; border: 1px solid #ddd; }
  table.grid td { padding: 6px 8px; border: 1px solid #ddd; }
  ul { margin: 4px 0 0 18px; padding: 0; }
  .muted { color: #888; }
  footer { margin-top: 28px; border-top: 1px solid #ddd; padding-top: 8px; display: flex; justify-content: space-between; color: #888; font-size: 10px; }
  .sign { margin-top: 40px; display: flex; justify-content: space-between; gap: 40px; }
  .sign div { flex: 1; border-top: 1px dotted #999; padding-top: 4px; text-align: center; font-size: 10px; color: #777; }
</style>
</head>
<body>
  <header>
    <div class="brand">${escapeHtml(company.name)}<small>${escapeHtml(company.nameEn || 'SYSTEM DOCUMENT')}</small></div>
    <div class="company-meta">${companyMeta}</div>
    <div class="doc-title">
      <h1>${escapeHtml(def.label)}</h1>
      <div class="code">${escapeHtml(row.code)}</div>
      ${status ? `<span class="badge">${escapeHtml(status.label)}</span>` : ''}
    </div>
  </header>
  ${sections.join('')}
  ${company.footerNote ? `<div class="doc-note">${escapeHtml(company.footerNote).replace(/\n/g, '<br>')}</div>` : ''}
  <div class="sign"><div>ผู้จัดทำ</div><div>ผู้ตรวจสอบ</div><div>ผู้อนุมัติ</div></div>
  <footer>
    <span>สร้างโดย ${escapeHtml(row['_createdByName'] ?? user.name)} · ${escapeHtml(fmtThaiDateTime(row['_createdAt']))}</span>
    <span>พิมพ์เมื่อ ${escapeHtml(fmtThaiDateTime(new Date().toISOString()))}</span>
  </footer>
</body>
</html>`;
  }

  /** เทมเพลต PDF สำหรับรายงานแบบตาราง พร้อมหัวบริษัทและช่องลงนาม */
  private reportHtml(input: ReportPdfInput): string {
    const company = this.company.get();
    const meta = [company.address, company.taxId ? `เลขประจำตัวผู้เสียภาษี ${company.taxId}` : '', company.phone, company.email, company.website]
      .filter(Boolean)
      .map((line) => escapeHtml(line))
      .join('<br>');
    const head = input.columns
      .map((col) => `<th class="${col.align === 'right' ? 'right' : ''}">${escapeHtml(col.label)}</th>`)
      .join('');
    const body = input.rows.length
      ? input.rows
          .map(
            (row) =>
              `<tr>${row
                .map((cell, index) => `<td class="${input.columns[index]?.align === 'right' ? 'right' : ''}">${escapeHtml(cell)}</td>`)
                .join('')}</tr>`,
          )
          .join('')
      : `<tr><td class="muted" colspan="${Math.max(1, input.columns.length)}">ไม่มีข้อมูลในช่วงเวลานี้</td></tr>`;
    const summary = input.summary?.length
      ? `<div class="summary">${input.summary
          .map((item) => `<div><span>${escapeHtml(item.label)}</span><b>${escapeHtml(item.value)}</b></div>`)
          .join('')}</div>`
      : '';

    return `<!doctype html>
<html lang="th"><head><meta charset="utf-8" />
<title>${escapeHtml(input.title)}</title>
<style>
  @page { size: A4 landscape; margin: 12mm 12mm 14mm; }
  * { box-sizing: border-box; }
  body { margin: 0; color: #1f2328; font-family: "Leelawadee UI", "Tahoma", "Segoe UI", sans-serif; font-size: 11px; line-height: 1.5; }
  header { display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; border-bottom: 2px solid #dc2f36; padding-bottom: 10px; margin-bottom: 14px; }
  .brand { font-size: 20px; font-weight: 800; color: #dc2f36; }
  .brand small { display: block; font-size: 9px; font-weight: 500; color: #6b6b6b; letter-spacing: 1px; }
  .company-meta { flex: 1; text-align: center; font-size: 9px; color: #666; line-height: 1.5; }
  .doc-title { text-align: right; }
  .doc-title h1 { margin: 0 0 2px; font-size: 16px; }
  .doc-title .sub { font-size: 10px; color: #555; }
  .summary { display: flex; gap: 8px; flex-wrap: wrap; margin: 0 0 10px; }
  .summary div { border: 1px solid #e5ded8; background: #faf7f4; border-radius: 6px; padding: 6px 10px; min-width: 120px; }
  .summary span { display: block; font-size: 9px; color: #777; }
  .summary b { font-size: 12px; }
  table { width: 100%; border-collapse: collapse; }
  th { background: #faf7f4; text-align: left; font-weight: 600; padding: 5px 7px; border: 1px solid #ddd; }
  td { padding: 5px 7px; border: 1px solid #e3e3e3; }
  .right { text-align: right; font-variant-numeric: tabular-nums; }
  .muted { color: #999; text-align: center; }
  footer { margin-top: 18px; border-top: 1px solid #ddd; padding-top: 6px; display: flex; justify-content: space-between; color: #888; font-size: 9px; }
</style></head><body>
  <header>
    <div class="brand">${escapeHtml(company.name)}<small>${escapeHtml(company.nameEn || 'SJP ERP')}</small></div>
    <div class="company-meta">${meta}</div>
    <div class="doc-title"><h1>${escapeHtml(input.title)}</h1>${input.subtitle ? `<div class="sub">${escapeHtml(input.subtitle)}</div>` : ''}</div>
  </header>
  ${summary}
  <table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>
  ${company.footerNote ? `<div class="muted" style="text-align:left;margin-top:10px;font-size:9px">${escapeHtml(company.footerNote)}</div>` : ''}
  <footer>
    <span>สร้างโดย ${escapeHtml(input.userName)} · ${escapeHtml(fmtThaiDateTime(new Date().toISOString()))}</span>
    <span>${escapeHtml(company.website || '')}</span>
  </footer>
</body></html>`;
  }

  private value(field: FieldDef, value: unknown, label: string | undefined, money: boolean): string {
    if (value === undefined || value === null || value === '') return '<span class="muted">–</span>';
    if (field.type === 'ref') return escapeHtml(label ?? value);
    if (field.type === 'boolean') return value ? 'ใช่' : 'ไม่';
    if (field.type === 'date') return escapeHtml(fmtThaiDate(value));
    if (field.type === 'datetime') return escapeHtml(fmtThaiDateTime(value));
    if (field.type === 'file') {
      const files = Array.isArray(value) ? (value as { name?: string }[]) : [];
      return files.length ? files.map((file) => escapeHtml(file.name ?? 'ไฟล์')).join('<br>') : '<span class="muted">–</span>';
    }
    if (field.type === 'multiselect') return escapeHtml(Array.isArray(value) ? value.join(', ') : value);
    if (field.type === 'number' || money) return escapeHtml(num(value));
    if (field.type === 'textarea') return escapeHtml(value).replace(/\n/g, '<br>');
    return escapeHtml(value);
  }
}

