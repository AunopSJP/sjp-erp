import { InjectDrizzle } from '@nestjs/drizzle';
import { Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { createReadStream, chmodSync, existsSync, mkdirSync, readFileSync, readdirSync, unlinkSync, writeFileSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { extname, join } from 'node:path';
import { and, eq, like } from 'drizzle-orm';
import type { Response } from 'express';
import type { Db } from '../db/database.service.js';
import { files, records } from '../db/schema.js';
import type { SafeUser } from '../auth/user.types.js';
import { AccessService } from '../common/access.service.js';
import { AuditService } from '../common/audit.service.js';
import { nowIso } from '../common/dates.js';
import { bad, forbidden, notFound } from '../common/exceptions.js';
import { getEntity } from '../meta/entities.js';
import { matchesFileSignature } from './file-signature.js';
import { currentWorkspaceId } from '../common/workspace-context.js';

export interface UploadedFileInput {
  originalname: string;
  mimetype: string;
  size: number;
  buffer: Buffer;
}

export type FileRow = typeof files.$inferSelect;

export interface BackupFileEntry {
  id: string;
  name: string;
  mime: string;
  size: number;
  uploadedBy: string | null;
  createdAt: string;
  data: string;
}

const MAX_SIZE = 15 * 1024 * 1024;
const MAX_FILES_PER_USER = 500;
const MAX_BYTES_PER_USER = 500 * 1024 * 1024;
const MAX_BACKUP_BYTES = 250 * 1024 * 1024;

const MIME_BY_EXT: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.pdf': 'application/pdf',
  '.txt': 'text/plain',
  '.csv': 'text/csv',
  '.doc': 'application/msword',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.xls': 'application/vnd.ms-excel',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.ppt': 'application/vnd.ms-powerpoint',
  '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  '.zip': 'application/zip',
  '.rar': 'application/vnd.rar',
  '.7z': 'application/x-7z-compressed',
  '.dwg': 'application/octet-stream',
  '.dxf': 'application/octet-stream',
};

@Injectable()
export class FilesService implements OnModuleInit {
  private readonly dir = process.env.UPLOAD_DIR ?? join(process.cwd(), 'data', 'uploads');
  private readonly logger = new Logger(FilesService.name);

  constructor(
    @InjectDrizzle() private readonly db: Db,
    private readonly access: AccessService,
    private readonly audit: AuditService,
  ) {}

  onModuleInit(): void {
    if (!existsSync(this.dir)) mkdirSync(this.dir, { recursive: true });
    try {
      chmodSync(this.dir, 0o700);
    } catch (error) {
      // Windows may not support POSIX modes: keep running, but leave a trace.
      this.logger.warn(`chmod upload dir skipped: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  async save(user: SafeUser, file: UploadedFileInput | undefined) {
    this.access.requireUploadFiles(user);
    if (!file || !file.buffer?.length) bad('กรุณาเลือกไฟล์');
    if (file.buffer.length > MAX_SIZE) bad('ไฟล์ต้องมีขนาดไม่เกิน 15 MB');

    const existing = this.db.select().from(files)
      .where(and(eq(files.uploadedBy, user.id), eq(files.workspaceId, currentWorkspaceId())))
      .all();
    if (existing.length >= MAX_FILES_PER_USER) bad(`อัปโหลดได้ไม่เกิน ${MAX_FILES_PER_USER} ไฟล์ต่อผู้ใช้`);
    if (existing.reduce((sum, row) => sum + row.size, 0) + file.buffer.length > MAX_BYTES_PER_USER) {
      bad('พื้นที่ไฟล์ของผู้ใช้เต็มแล้ว กรุณาลบไฟล์เก่าก่อน');
    }

    const name = String(file.originalname ?? '')
      .replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_')
      .trim()
      .slice(0, 255) || 'file';
    const ext = extname(name).toLowerCase().replace(/[^.a-z0-9]/g, '').slice(0, 12);
    const mime = MIME_BY_EXT[ext];
    if (!mime) bad('ชนิดไฟล์นี้ไม่อนุญาตให้อัปโหลด');
    if (!matchesFileSignature(ext, file.buffer)) bad('เนื้อหาไฟล์ไม่ตรงกับชนิดไฟล์ที่ระบุ');
    const id = crypto.randomUUID();
    const path = join(this.dir, `${id}${ext}`);
    await writeFile(path, file.buffer, { mode: 0o600 });
    const row: typeof files.$inferInsert = {
      id,
      workspaceId: currentWorkspaceId(),
      name,
      mime,
      size: file.buffer.length,
      path,
      uploadedBy: user.id,
      createdAt: nowIso(),
    };
    this.db.insert(files).values(row).run();
    this.audit.log(user, { action: 'upload', entity: 'files', recordId: id, recordCode: name, summary: `อัปโหลดไฟล์ ${name}` });
    return this.publicFile(row as FileRow);
  }

  send(user: SafeUser, id: string, res: Response): void {
    const row = this.db.select().from(files).where(and(eq(files.id, id), eq(files.workspaceId, currentWorkspaceId()))).all()[0];
    if (!row) notFound('ไม่พบไฟล์');
    if (!existsSync(row.path)) notFound('ไม่พบไฟล์บนเซิร์ฟเวอร์');
    if (!this.canRead(user, row)) forbidden('ไม่มีสิทธิ์เข้าถึงไฟล์นี้');
    const mime = /^[a-z0-9][a-z0-9.+-]*\/[a-z0-9][a-z0-9.+-]*$/i.test(row.mime) ? row.mime : 'application/octet-stream';
    res.setHeader('Content-Type', mime);
    res.setHeader('Content-Length', String(row.size));
    res.setHeader('Cache-Control', 'private, max-age=3600');
    res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(row.name)}`);
    createReadStream(row.path).pipe(res);
  }

  remove(user: SafeUser, id: string): { ok: true } {
    this.access.require(user, 'settings', 'edit');
    const row = this.db.select().from(files).where(and(eq(files.id, id), eq(files.workspaceId, currentWorkspaceId()))).all()[0];
    if (!row) notFound('ไม่พบไฟล์');
    this.db.delete(files).where(and(eq(files.id, id), eq(files.workspaceId, currentWorkspaceId()))).run();
    try {
      if (existsSync(row.path)) unlinkSync(row.path);
    } catch (error) {
      // The database row is already gone; report the orphaned file for cleanup.
      this.logger.warn(`ลบไฟล์บนดิสก์ไม่สำเร็จ ${row.path}: ${error instanceof Error ? error.message : String(error)}`);
    }
    this.audit.log(user, { action: 'delete', entity: 'files', recordId: id, recordCode: row.name, summary: `ลบไฟล์ ${row.name}` });
    return { ok: true };
  }

  private canRead(user: SafeUser, row: FileRow): boolean {
    if (user.isAdmin) return true;
    if (row.uploadedBy && row.uploadedBy === user.id) return true;
    if (this.access.can(user, 'settings', 'view')) return true;
    const candidates = this.db
      .select()
      .from(records)
      .where(and(like(records.data, `%${row.id}%`), eq(records.workspaceId, currentWorkspaceId())))
      .all();
    return candidates.some((record) => {
      let def;
      try {
        def = getEntity(record.entity);
      } catch {
        return false;
      }
      if (!JSON.stringify(record.data).includes(row.id)) return false;
      return this.access.canEntity(user, record.entity, 'view') && this.access.canSee(user, def, record);
    });
  }

  exportAll(): BackupFileEntry[] {
    const rows = this.db.select().from(files)
      .where(eq(files.workspaceId, currentWorkspaceId()))
      .all().filter((row) => existsSync(row.path));
    const total = rows.reduce((sum, row) => sum + (Number(row.size) || 0), 0);
    if (total > MAX_BACKUP_BYTES) {
      bad('ไฟล์แนบมีขนาดใหญ่เกินกว่าจะสำรองเป็น JSON ได้ กรุณาสำรองฐานข้อมูลโดยตรง');
    }
    return rows
      .map((row) => ({
        id: row.id,
        name: row.name,
        mime: row.mime,
        size: row.size,
        uploadedBy: row.uploadedBy ?? null,
        createdAt: row.createdAt,
        data: readFileSync(row.path).toString('base64'),
      }));
  }

  restoreAll(entries: unknown): number {
    if (!Array.isArray(entries)) return 0;
    const prepared: { id: string; name: string; mime: string; uploadedBy: string | null; createdAt: string; buffer: Buffer; path: string }[] = [];
    let totalBytes = 0;
    for (const raw of entries) {
      if (!raw || typeof raw !== 'object') continue;
      const entry = raw as Partial<BackupFileEntry>;
      if (!entry.data || !entry.name) continue;
      const buffer = Buffer.from(String(entry.data), 'base64');
      if (!buffer.length) continue;
      totalBytes += buffer.length;
      if (totalBytes > MAX_BACKUP_BYTES) bad('ไฟล์แนบในชุดสำรองมีขนาดใหญ่เกินไป');
      const baseName = String(entry.name).slice(0, 255);
      const id = /^[A-Za-z0-9-]{8,64}$/.test(String(entry.id ?? '')) ? String(entry.id) : crypto.randomUUID();
      const ext = extname(baseName).toLowerCase().replace(/[^.a-z0-9]/g, '').slice(0, 12);
      prepared.push({
        id,
        name: baseName,
        mime: String(entry.mime ?? 'application/octet-stream'),
        uploadedBy: entry.uploadedBy ?? null,
        createdAt: String(entry.createdAt ?? nowIso()),
        buffer,
        path: join(this.dir, `${id}${ext}`),
      });
    }
    if (entries.length > 0 && prepared.length === 0) return 0;

    mkdirSync(this.dir, { recursive: true });
    // Write new files first so a failure never destroys existing attachments.
    for (const file of prepared) writeFileSync(file.path, file.buffer, { mode: 0o600 });

    this.db.transaction((tx) => {
      tx.delete(files).run();
      for (const file of prepared) {
        tx.insert(files).values({
          id: file.id,
          workspaceId: currentWorkspaceId(),
          name: file.name,
          mime: file.mime,
          size: file.buffer.length,
          path: file.path,
          uploadedBy: file.uploadedBy,
          createdAt: file.createdAt,
        }).run();
      }
    });

    const keep = new Set(prepared.map((file) => file.path));
    for (const name of readdirSync(this.dir)) {
      const path = join(this.dir, name);
      if (keep.has(path)) continue;
      try {
        unlinkSync(path);
      } catch (error) {
        // Old backups may be locked by another process; keep the restore result.
        this.logger.warn(`ลบไฟล์สำรองเก่าไม่สำเร็จ ${path}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    return prepared.length;
  }

  private publicFile(row: FileRow) {
    return {
      id: row.id,
      name: row.name,
      mime: row.mime,
      size: row.size,
      url: `/api/files/${row.id}`,
      createdAt: row.createdAt,
    };
  }
}
