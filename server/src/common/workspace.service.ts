import { InjectDrizzle } from '@nestjs/drizzle';
import { Injectable } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import type { Db } from '../db/database.service.js';
import { settings } from '../db/schema.js';
import type { SafeUser } from '../auth/user.types.js';
import { bad } from './exceptions.js';
import { nowIso } from './dates.js';

export interface WorkspaceWidgetPosition {
  x: number;
  y: number;
  w: number;
  z: number;
  h?: number;
}

export interface WorkspaceLayer {
  id: string;
  name: string;
  widgets: Record<string, WorkspaceWidgetPosition>;
  hidden: string[];
}

export interface WorkspaceConfig {
  version: number;
  widgets: Record<string, WorkspaceWidgetPosition>;
  hidden: string[];
  updatedAt: string;
  activeLayerId: string;
  layers: WorkspaceLayer[];
}

const KEY_PREFIX = 'workspace:';
const KEY_PATTERN = /^[a-z0-9-]{1,40}$/;
const MAX_WIDGETS = 60;
const MAX_LAYERS = 8;
const MAX_BYTES = 256_000;

const clamp = (value: unknown, min: number, max: number): number => {
  const number = Number(value);
  if (!Number.isFinite(number)) return min;
  return Math.min(max, Math.max(min, number));
};

const empty = (): WorkspaceConfig => ({ version: 1, widgets: {}, hidden: [], updatedAt: '', activeLayerId: '', layers: [] });

@Injectable()
export class WorkspaceService {
  constructor(@InjectDrizzle() private readonly db: Db) {}

  private key(user: SafeUser): string {
    return `${KEY_PREFIX}${user.id}`;
  }

  get(user: SafeUser): WorkspaceConfig {
    const row = this.db.select().from(settings).where(eq(settings.key, this.key(user))).all()[0];
    if (!row) return empty();
    return this.sanitize(row.value, false);
  }

  save(user: SafeUser, input: unknown): WorkspaceConfig {
    const safe = this.sanitize(input, true);
    safe.updatedAt = nowIso();
    const value = safe as unknown;
    const existing = this.db.select().from(settings).where(eq(settings.key, this.key(user))).all()[0];
    if (existing) this.db.update(settings).set({ value }).where(eq(settings.key, this.key(user))).run();
    else this.db.insert(settings).values({ key: this.key(user), value }).run();
    return safe;
  }

  reset(user: SafeUser): WorkspaceConfig {
    this.db.delete(settings).where(eq(settings.key, this.key(user))).run();
    return empty();
  }

  private sanitize(input: unknown, strict: boolean): WorkspaceConfig {
    if (!input || typeof input !== 'object') {
      if (strict) bad('รูปแบบการจัดหน้าจอไม่ถูกต้อง');
      return empty();
    }
    const source = input as {
      version?: unknown;
      widgets?: unknown;
      hidden?: unknown;
      updatedAt?: unknown;
      activeLayerId?: unknown;
      layers?: unknown;
    };

    const layers: WorkspaceLayer[] = [];
    if (Array.isArray(source.layers)) {
      for (const raw of source.layers.slice(0, MAX_LAYERS)) {
        const layer = this.sanitizeLayer(raw);
        if (!layer || layers.some((item) => item.id === layer.id)) continue;
        layers.push(layer);
      }
    }

    let activeLayerId = String(source.activeLayerId ?? '').trim();
    if (!layers.some((layer) => layer.id === activeLayerId)) activeLayerId = layers[0]?.id ?? '';
    const active = layers.find((layer) => layer.id === activeLayerId);

    const config: WorkspaceConfig = {
      version: 1,
      widgets: active ? active.widgets : this.sanitizeWidgets(source.widgets),
      hidden: active ? active.hidden : this.sanitizeHidden(source.hidden),
      updatedAt: typeof source.updatedAt === 'string' ? source.updatedAt : '',
      activeLayerId,
      layers,
    };
    if (JSON.stringify(config).length > MAX_BYTES) {
      if (strict) bad('ข้อมูลการจัดหน้าจอใหญ่เกินไป');
      return empty();
    }
    return config;
  }

  private sanitizeLayer(raw: unknown): WorkspaceLayer | null {
    if (!raw || typeof raw !== 'object') return null;
    const source = raw as { id?: unknown; name?: unknown; widgets?: unknown; hidden?: unknown };
    const id = String(source.id ?? '').trim();
    if (!KEY_PATTERN.test(id)) return null;
    return {
      id,
      name: String(source.name ?? '').trim().slice(0, 40) || id,
      widgets: this.sanitizeWidgets(source.widgets),
      hidden: this.sanitizeHidden(source.hidden),
    };
  }

  private sanitizeWidgets(raw: unknown): Record<string, WorkspaceWidgetPosition> {
    const widgets: Record<string, WorkspaceWidgetPosition> = {};
    if (!raw || typeof raw !== 'object') return widgets;
    for (const [key, value] of Object.entries(raw as Record<string, unknown>).slice(0, MAX_WIDGETS)) {
      if (!KEY_PATTERN.test(key) || !value || typeof value !== 'object') continue;
      const position = value as { x?: unknown; y?: unknown; w?: unknown; z?: unknown; h?: unknown };
      let x = clamp(position.x, 0, 100);
      let w = clamp(position.w, 6, 100);
      if (x + w > 100) w = Math.max(6, 100 - x);
      if (x + w > 100) x = Math.max(0, 100 - w);
      const height = clamp(position.h, 0, 20_000);
      widgets[key] = {
        x: Math.round(x * 100) / 100,
        y: Math.round(clamp(position.y, 0, 100_000)),
        w: Math.round(w * 100) / 100,
        z: Math.round(clamp(position.z, 0, 10_000)),
        ...(Number(position.h) > 0 ? { h: Math.round(height) } : {}),
      };
    }
    return widgets;
  }

  private sanitizeHidden(raw: unknown): string[] {
    const hidden: string[] = [];
    if (!Array.isArray(raw)) return hidden;
    for (const key of raw.slice(0, MAX_WIDGETS)) {
      if (typeof key === 'string' && KEY_PATTERN.test(key) && !hidden.includes(key)) hidden.push(key);
    }
    return hidden;
  }
}

