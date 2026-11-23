import { ChangeDetectionStrategy, Component, OnDestroy, OnInit, computed, inject, signal } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { ApiService, apiErrorMessage } from '../core/api.service';
import { AuthService } from '../core/auth.service';
import { MetaService } from '../core/meta.service';
import { IconComponent } from '../shared/icon.component';
import { StateComponent } from '../shared/state.component';
import { ToastService } from '../shared/toast.service';
import { WorkspaceWidgetComponent } from './workspace-widget.component';
import type { DashboardData, WorkspaceConfig, WorkspaceLayer, WorkspaceWidgetDef, WorkspaceWidgetPosition } from '../core/dashboard.models';
import { packWorkspaceRows } from '../core/workspace-layout';

const SNAP_Y = 8;
const MIN_WIDTH = 18;
const MAX_LAYERS = 8;

type LayerTemplate = 'blank' | 'ops' | 'exec' | 'finance';

// แม่แบบเลเยอร์สำหรับงานแต่ละโหมด (ซ่อนการ์ดที่ไม่เกี่ยว)
const LAYER_PRESETS: Record<Exclude<LayerTemplate, 'blank'>, { name: string; hidden: string[] }> = {
  ops: { name: 'ปฏิบัติการ', hidden: ['finance', 'project-steps', 'pm', 'assignee'] },
  exec: { name: 'ผู้บริหาร', hidden: ['my-work', 'queue', 'status', 'team', 'assignee', 'pm'] },
  finance: { name: 'การเงิน', hidden: ['my-work', 'queue', 'status', 'team', 'assignee', 'project-steps', 'pm'] },
};

const round = (value: number, step = 0.5): number => Math.round(value / step) * step;

@Component({
  selector: 'app-workspace',
  standalone: true,
  imports: [IconComponent, StateComponent, WorkspaceWidgetComponent],
  template: `
    <div class="page ws-page">
      <header class="page-head ws-head">
        <div>
          <div class="dash-kicker">พื้นที่ทำงานส่วนตัว</div>
          <h1>โต๊ะทำงาน</h1>
          <div class="muted">ลากการ์ดไปวางที่ไหนก็ได้ ปรับความกว้าง และซ่อนการ์ดที่ไม่ใช้ — ระบบบันทึกให้อัตโนมัติ</div>
        </div>
        <div class="page-actions">
          @if (!editing()) {
            <button type="button" class="btn" [disabled]="!desktop()" [title]="desktop() ? 'จัดหน้าจอ' : 'จัดหน้าจอแบบอิสระได้บนจอใหญ่'" (click)="startEdit()">
              <app-icon name="grid" [size]="14" /> {{ desktop() ? 'จัดหน้าจอ' : 'จัดหน้าจอบนจอใหญ่' }}
            </button>
            @if (hasCustomLayout()) { <button type="button" class="btn ghost" (click)="resetLayout()">รีเซ็ต</button> }
          } @else {
            <span class="ws-save-state" role="status">{{ saving() ? 'กำลังบันทึก…' : savedAt() ? 'บันทึกอัตโนมัติแล้ว' : 'ยังไม่มีการเปลี่ยนแปลง' }}</span>
            <button type="button" class="btn" (click)="autoArrange()" title="จัดเรียงการ์ดให้ช่องว่างเท่ากันและแน่นพอดี"><app-icon name="grid" [size]="14" /> จัดเรียงให้พอดี</button>
            <button type="button" class="btn ghost" (click)="resetLayout()">รีเซ็ต</button>
            <button type="button" class="btn primary" (click)="finishEdit()">เสร็จสิ้น</button>
          }
        </div>
      </header>

      <div class="ws-layers" role="tablist" aria-label="เลเยอร์หน้าจอ">
        @for (layer of layers(); track layer.id) {
          <button type="button" role="tab" class="ws-layer" [class.active]="layer.id === activeLayerId()" [attr.aria-selected]="layer.id === activeLayerId()" (click)="switchLayer(layer.id)">
            {{ layer.name }}
            @if (layer.id === activeLayerId() ? hidden().length : layer.hidden.length; as hiddenCount) {
              <span class="ws-layer-count" [attr.title]="hiddenCount + ' การ์ดที่ซ่อน'">{{ hiddenCount }}</span>
            }
          </button>
        }
        @if (editing()) {
          <span class="ws-layers-actions">
            <button type="button" class="ws-layer add" (click)="addLayer()">+ เลเยอร์</button>
            <select class="ws-layer select" aria-label="เพิ่มเลเยอร์จากแม่แบบ" (change)="addLayerFromTemplate($any($event.target).value); $any($event.target).value = ''">
              <option value="">+ จากแม่แบบ…</option>
              <option value="ops">ปฏิบัติการ</option>
              <option value="exec">ผู้บริหาร</option>
              <option value="finance">การเงิน</option>
            </select>
            <button type="button" class="ws-layer ghost" (click)="duplicateLayer()">ทำสำเนา</button>
            <button type="button" class="ws-layer ghost" (click)="renameLayer()">เปลี่ยนชื่อ</button>
            @if (layers().length > 1) { <button type="button" class="ws-layer danger" (click)="deleteLayer(activeLayerId())">ลบ</button> }
          </span>
        }
      </div>

      @if (loading()) {
        <app-state kind="loading" message="กำลังโหลดโต๊ะทำงาน…" />
      } @else if (error()) {
        <div class="state error">{{ error() }}</div>
      } @else if (data(); as d) {
        @if (editing()) {
          <div class="ws-editor-bar">
            <div class="ws-editor-hint">
              <app-icon name="grid" [size]="14" />
              ลากการ์ดเพื่อย้าย · ลากมุมขวาล่างเพื่อปรับความกว้าง · การ์ดที่ลากล่าสุดจะอยู่ด้านบนสุด
            </div>
            <div class="ws-catalog">
              @for (w of catalog(); track w.key) {
                <button type="button" class="ws-chip" [class.off]="isHidden(w.key)" (click)="toggleHidden(w.key)" [attr.aria-pressed]="!isHidden(w.key)">
                  <app-icon [name]="w.icon" [size]="13" />
                  {{ w.title }}
                  <span class="ws-chip-state">{{ isHidden(w.key) ? 'ซ่อน' : 'แสดง' }}</span>
                </button>
              }
            </div>
          </div>
        }

        @if (!visibleWidgets().length) {
          <div class="state empty">ซ่อนการ์ดทั้งหมดอยู่ — กด “จัดหน้าจอ” แล้วเลือกแสดงการ์ดที่ต้องการ</div>
        } @else if (canvasPositions(); as pos) {
          <div class="ws-canvas" [class.editing]="editing()" [style.min-height.px]="canvasHeight()">
            @for (w of visibleWidgets(); track w.key) {
              <div
                class="ws-widget ws-absolute"
                [class.editing]="editing()"
                [class.dragging]="dragKey() === w.key"
                [style.z-index]="pos[w.key]?.z ?? 0"
                [style.left.%]="pos[w.key]?.x ?? 0"
                [style.top.px]="pos[w.key]?.y ?? 0"
                [style.width.%]="pos[w.key]?.w ?? 100"
                [style.height.px]="pos[w.key]?.h ?? null"
                [attr.data-widget]="w.key"
              >
                @if (editing()) {
                  <div
                    class="ws-toolbar"
                    role="button"
                    tabindex="0"
                    [attr.aria-label]="'ย้ายการ์ด ' + w.title"
                    title="ลากเพื่อย้าย"
                    (pointerdown)="startDrag($event, w.key)"
                    (keydown)="moveWithKeyboard($event, w.key)"
                  >
                    <app-icon name="grid" [size]="13" class="ws-grip" />
                    <b>{{ w.title }}</b>
                    <span class="grow"></span>
                    <button type="button" class="ws-icon" (pointerdown)="$event.stopPropagation()" (click)="toggleHidden(w.key)" [attr.aria-label]="'ซ่อนการ์ด ' + w.title">×</button>
                  </div>
                }
                <app-workspace-widget [widget]="w" [data]="d" />
                @if (editing()) { <span class="ws-resize" (pointerdown)="startResize($event, w.key)" aria-hidden="true"></span> }
              </div>
            }
          </div>
        } @else {
          <div class="ws-flow">
            @for (w of flowWidgets(); track w.key) {
              <div
                class="ws-widget"
                [class.editing]="editing()"
                [class.dragging]="dragKey() === w.key"
                [style.grid-column]="desktop() ? 'span ' + w.span : null"
                [attr.data-widget]="w.key"
              >
                @if (editing()) {
                  <div
                    class="ws-toolbar"
                    role="button"
                    tabindex="0"
                    [attr.aria-label]="'ย้ายการ์ด ' + w.title"
                    title="ลากเพื่อย้าย"
                    (pointerdown)="startDrag($event, w.key)"
                    (keydown)="moveWithKeyboard($event, w.key)"
                  >
                    <app-icon name="grid" [size]="13" class="ws-grip" />
                    <b>{{ w.title }}</b>
                    <span class="grow"></span>
                    <button type="button" class="ws-icon" (pointerdown)="$event.stopPropagation()" (click)="toggleHidden(w.key)" [attr.aria-label]="'ซ่อนการ์ด ' + w.title">×</button>
                  </div>
                }
                <app-workspace-widget [widget]="w" [data]="d" />
              </div>
            }
          </div>
        }
      }
    </div>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class WorkspaceComponent implements OnInit, OnDestroy {
  readonly auth = inject(AuthService);
  private readonly api = inject(ApiService);
  private readonly meta = inject(MetaService);
  private readonly toast = inject(ToastService);
  private readonly route = inject(ActivatedRoute);

  readonly loading = signal(true);
  readonly error = signal('');
  readonly data = signal<DashboardData | null>(null);
  readonly editing = signal(false);
  readonly positions = signal<Record<string, WorkspaceWidgetPosition> | null>(null);
  readonly hidden = signal<string[]>([]);
  readonly layers = signal<WorkspaceLayer[]>([]);
  readonly activeLayerId = signal('');
  readonly saving = signal(false);
  readonly savedAt = signal('');
  readonly dragKey = signal('');
  private readonly heights = signal<Record<string, number>>({});
  private readonly savedWidgets = signal<Record<string, WorkspaceWidgetPosition> | null>(null);
  private dirty = false;
  private saveTimer: ReturnType<typeof setTimeout> | undefined;

  private readonly media = window.matchMedia('(min-width: 960px)');
  readonly desktop = signal(this.media.matches);
  private readonly onMediaChange = (event: MediaQueryListEvent): void => {
    this.desktop.set(event.matches);
    if (!event.matches) this.editing.set(false);
  };
  private readonly onResize = (): void => {
    if (this.positions()) setTimeout(() => this.measureHeights(), 16);
  };

  readonly catalog = computed<WorkspaceWidgetDef[]>(() => {
    const can = (resource: string, action = 'view'): boolean => this.auth.can(resource, action);
    const all: (WorkspaceWidgetDef & { available: boolean })[] = [
      {
        key: 'kpi',
        title: 'ตัวชี้วัดสำคัญ',
        icon: 'chart',
        span: 12,
        available:
          can('tickets') || can('pm') || can('projects') || can('purchase') || can('accounting') || can('warehouse') || can('assets'),
      },
      { key: 'my-work', title: 'งานของฉัน', icon: 'check', span: 6, available: can('tickets') || can('pm') || can('projects') },
      { key: 'approvals', title: 'คำขออนุมัติ', icon: 'bell', span: 6, available: can('tickets') || can('purchase') || can('accounting') },
      { key: 'queue', title: 'คิวงานที่ต้องจัดการ', icon: 'ticket', span: 7, available: can('tickets') },
      { key: 'activity', title: 'ความเคลื่อนไหวล่าสุด', icon: 'clock', span: 5, available: true },
      { key: 'finance', title: 'ภาพรวมการเงิน', icon: 'receipt', span: 12, available: can('accounting') },
      { key: 'status', title: 'เคสตามสถานะ', icon: 'chart', span: 4, available: can('tickets') },
      { key: 'team', title: 'เคสตามทีม', icon: 'user', span: 4, available: can('tickets') },
      { key: 'assignee', title: 'เคสตามผู้รับผิดชอบ', icon: 'user', span: 4, available: can('tickets') },
      { key: 'project-steps', title: 'โครงการตามขั้นตอน', icon: 'folder', span: 6, available: can('projects') },
      { key: 'pm', title: 'งาน PM', icon: 'wrench', span: 6, available: can('pm') },
      { key: 'shortcuts', title: 'ทางลัด', icon: 'grid', span: 12, available: true },
    ];
    return all.filter((widget) => widget.available).map(({ available, ...widget }) => widget);
  });

  readonly visibleWidgets = computed<WorkspaceWidgetDef[]>(() => {
    const hidden = new Set(this.hidden());
    return this.catalog().filter((widget) => !hidden.has(widget.key));
  });

  readonly flowWidgets = computed<WorkspaceWidgetDef[]>(() => {
    const widgets = this.visibleWidgets();
    const positions = this.positions();
    if (!positions) return widgets;
    return [...widgets].sort((a, b) => {
      const pa = positions[a.key];
      const pb = positions[b.key];
      return (pa?.y ?? 0) - (pb?.y ?? 0) || (pa?.x ?? 0) - (pb?.x ?? 0);
    });
  });

  readonly canvasPositions = computed<Record<string, WorkspaceWidgetPosition> | null>(() =>
    this.desktop() ? this.positions() : null,
  );

  readonly canvasHeight = computed(() => {
    const positions = this.positions();
    if (!positions) return 480;
    const heights = this.heights();
    let bottom = 480;
    for (const widget of this.visibleWidgets()) {
      const position = positions[widget.key];
      if (!position) continue;
      bottom = Math.max(bottom, position.y + (position.h ?? heights[widget.key] ?? 320) + 48);
    }
    return bottom;
  });

  ngOnInit(): void {
    this.media.addEventListener('change', this.onMediaChange);
    window.addEventListener('resize', this.onResize);
    this.meta.load();
    this.loadDashboard();
    this.loadLayout();
    if (this.route.snapshot.queryParamMap.get('edit') === '1') this.editing.set(true);
  }

  ngOnDestroy(): void {
    this.media.removeEventListener('change', this.onMediaChange);
    window.removeEventListener('resize', this.onResize);
    if (this.saveTimer) clearTimeout(this.saveTimer);
  }

  hasCustomLayout(): boolean {
    return !!this.positions() || this.hidden().length > 0;
  }

  isHidden(key: string): boolean {
    return this.hidden().includes(key);
  }

  startEdit(): void {
    if (!this.desktop()) {
      this.toast.error('จัดหน้าจอแบบอิสระใช้ได้บนจอใหญ่ กรุณาเปิดบนคอมพิวเตอร์หรือแท็บเล็ตแนวนอน');
      return;
    }
    this.editing.set(true);
    if (!this.positions()) {
      setTimeout(() => this.captureFlow(), 16);
    } else {
      setTimeout(() => this.measureHeights(), 16);
    }
  }

  finishEdit(): void {
    this.editing.set(false);
    if (this.dirty) {
      void this.flushSave();
    } else {
      this.positions.set(this.savedWidgets());
    }
  }

  toggleHidden(key: string): void {
    const hidden = this.hidden();
    const next = hidden.includes(key) ? hidden.filter((item) => item !== key) : [...hidden, key];
    this.hidden.set(next);
    if (!next.includes(key)) this.ensurePosition(key);
    this.markDirty();
    if (this.positions()) setTimeout(() => this.measureHeights(), 16);
  }

  autoArrange(): void {
    const apply = (pass: number): void => {
      if (!document.querySelector('.ws-canvas')) {
        if (pass > 0) setTimeout(() => apply(pass - 1), 60);
        return;
      }
      this.measureHeights();
      const packed = this.packWidgets();
      if (!packed) {
        if (pass > 0) setTimeout(() => apply(pass - 1), 60);
        return;
      }
      this.positions.set(packed);
      this.markDirty();
      // Widths change when widgets move, which reflows text and heights.
      // Two extra passes let the packing settle without overlaps.
      if (pass > 0) setTimeout(() => apply(pass - 1), 16);
      else setTimeout(() => this.verifyPacked(), 80);
    };
    if (!this.positions()) {
      this.positions.set(null);
      setTimeout(() => {
        this.captureFlow();
        setTimeout(() => apply(2), 16);
      }, 16);
    } else {
      setTimeout(() => apply(2), 16);
    }
  }

  resetLayout(): void {
    if (!confirm('รีเซ็ตการจัดหน้าจอเป็นค่าเริ่มต้นหรือไม่?')) return;
    this.api.delete<WorkspaceConfig>('/prefs/workspace').subscribe({
      next: () => {
        this.positions.set(null);
        this.savedWidgets.set(null);
        this.hidden.set([]);
        this.layers.set([{ id: 'default', name: 'หลัก', widgets: {}, hidden: [] }]);
        this.activeLayerId.set('default');
        this.editing.set(false);
        this.savedAt.set('');
        this.dirty = false;
        this.toast.show('รีเซ็ตการจัดหน้าจอแล้ว');
      },
      error: (error: unknown) => this.toast.error(apiErrorMessage(error)),
    });
  }

  startDrag(event: PointerEvent, key: string): void {
    if (!this.editing() || !this.desktop()) return;
    if ((event.target as HTMLElement).closest('button')) return;
    const positions = this.positions();
    const canvas = document.querySelector('.ws-canvas') as HTMLElement | null;
    if (!positions || !canvas) return;
    const raised = this.raise(positions, key);
    const position = raised[key];
    if (!position) return;
    event.preventDefault();
    this.positions.set(raised);
    const rect = canvas.getBoundingClientRect();
    const start = { clientX: event.clientX, clientY: event.clientY, x: position.x, y: position.y, w: position.w };
    this.dragKey.set(key);

    const move = (moveEvent: PointerEvent): void => {
      const dx = ((moveEvent.clientX - start.clientX) / Math.max(1, rect.width)) * 100;
      const x = round(Math.min(Math.max(0, start.x + dx), 100 - start.w));
      const y = Math.max(0, Math.round((start.y + moveEvent.clientY - start.clientY) / SNAP_Y) * SNAP_Y);
      this.positions.update((current) => (current ? { ...current, [key]: { ...position, x, y } } : current));
    };
    const up = (): void => {
      document.removeEventListener('pointermove', move);
      document.removeEventListener('pointerup', up);
      this.dragKey.set('');
      this.markDirty();
    };
    document.addEventListener('pointermove', move, { passive: true });
    document.addEventListener('pointerup', up, { once: true });
  }

  startResize(event: PointerEvent, key: string): void {
    if (!this.editing() || !this.desktop()) return;
    const positions = this.positions();
    const canvas = document.querySelector('.ws-canvas') as HTMLElement | null;
    if (!positions || !canvas) return;
    const raised = this.raise(positions, key);
    const current = raised[key];
    if (!current) return;
    // ปรับความกว้างเองแล้ว ให้ความสูงกลับเป็นอัตโนมัติ (ไม่คงความสูงแถวเดิม)
    const position = { ...current, h: undefined };
    raised[key] = position;
    event.preventDefault();
    event.stopPropagation();
    this.positions.set(raised);
    const rect = canvas.getBoundingClientRect();
    const start = { clientX: event.clientX, w: position.w };
    const move = (moveEvent: PointerEvent): void => {
      const dx = ((moveEvent.clientX - start.clientX) / Math.max(1, rect.width)) * 100;
      const max = Math.max(MIN_WIDTH, 100 - position.x);
      const w = round(Math.min(Math.max(MIN_WIDTH, start.w + dx), max), 1);
      this.positions.update((current) => (current ? { ...current, [key]: { ...position, w } } : current));
      setTimeout(() => this.measureHeights(), 16);
    };
    const up = (): void => {
      document.removeEventListener('pointermove', move);
      document.removeEventListener('pointerup', up);
      this.markDirty();
    };
    document.addEventListener('pointermove', move, { passive: true });
    document.addEventListener('pointerup', up, { once: true });
  }

  moveWithKeyboard(event: KeyboardEvent, key: string): void {
    if (!this.editing()) return;
    const positions = this.positions();
    if (!positions) return;
    const raised = this.raise(positions, key);
    const position = raised[key];
    if (!position) return;
    const step = event.shiftKey ? 40 : 12;
    let x = position.x;
    let y = position.y;
    let w = position.w;
    if (event.key === 'ArrowLeft') x = Math.max(0, x - step / 10);
    else if (event.key === 'ArrowRight') x = Math.min(100 - position.w, x + step / 10);
    else if (event.key === 'ArrowUp') y = Math.max(0, y - step);
    else if (event.key === 'ArrowDown') y += step;
    else if (event.key === '+' || event.key === '=') w = Math.min(100 - position.x, w + 2);
    else if (event.key === '-') w = Math.max(MIN_WIDTH, w - 2);
    else return;
    event.preventDefault();
    this.positions.set({
      ...raised,
      [key]: { ...position, x: round(x), y: Math.round(y / SNAP_Y) * SNAP_Y, w: round(w, 1) },
    });
    this.markDirty();
    setTimeout(() => this.measureHeights(), 16);
  }

  private raise(positions: Record<string, WorkspaceWidgetPosition>, key: string): Record<string, WorkspaceWidgetPosition> {
    const current = positions[key];
    if (!current) return positions;
    const maxZ = Math.max(0, ...Object.values(positions).map((position) => position.z ?? 0));
    if ((current.z ?? 0) >= maxZ) return positions;
    return { ...positions, [key]: { ...current, z: maxZ + 1 } };
  }

  private loadDashboard(): void {
    this.api.get<DashboardData>('/dashboard').subscribe({
      next: (data) => {
        this.data.set(data);
        this.loading.set(false);
        if (this.editing() && !this.positions()) setTimeout(() => this.captureFlow(), 16);
        else if (this.positions()) setTimeout(() => this.measureHeights(), 16);
      },
      error: (error: unknown) => {
        this.loading.set(false);
        this.error.set(apiErrorMessage(error));
      },
    });
  }

  private loadLayout(): void {
    this.api.get<WorkspaceConfig>('/prefs/workspace').subscribe({
      next: (config) => {
        const allowed = new Set<string>(this.catalog().map((widget) => widget.key));
        const filterHidden = (list: string[] | undefined): string[] =>
          (list ?? []).filter((key) => allowed.has(key));

        const layers: WorkspaceLayer[] = (config.layers ?? [])
          .filter((layer) => layer && layer.id)
          .map((layer) => ({
            id: layer.id,
            name: layer.name || layer.id,
            widgets: layer.widgets ?? {},
            hidden: filterHidden(layer.hidden),
          }));

        if (!layers.length) {
          layers.push({
            id: 'default',
            name: 'หลัก',
            widgets: (config.widgets ?? {}) as Record<string, WorkspaceWidgetPosition>,
            hidden: filterHidden(config.hidden),
          });
        }

        const activeId = layers.some((layer) => layer.id === config.activeLayerId)
          ? String(config.activeLayerId)
          : layers[0].id;
        this.layers.set(layers);
        this.activeLayerId.set(activeId);
        this.savedAt.set(config.updatedAt ?? '');
        const active = layers.find((layer) => layer.id === activeId) ?? layers[0];
        this.applyLayer(active);
      },
      error: () => undefined,
    });
  }

  private applyLayer(layer: WorkspaceLayer): void {
    const widgets = Object.keys(layer.widgets ?? {}).length ? layer.widgets : null;
    this.positions.set(widgets);
    this.savedWidgets.set(widgets);
    this.hidden.set(layer.hidden ?? []);
    if (widgets) {
      setTimeout(() => {
        this.ensureVisiblePositions();
        setTimeout(() => this.measureHeights(), 16);
      }, 16);
    } else if (this.editing()) {
      setTimeout(() => this.captureFlow(), 16);
    }
  }

  /** Copies the live positions/hidden back into the active layer. */
  private stashLayer(): void {
    const id = this.activeLayerId();
    if (!id) return;
    const widgets = this.positions() ?? {};
    const hidden = this.hidden();
    this.layers.update((layers) => layers.map((layer) => (layer.id === id ? { ...layer, widgets, hidden } : layer)));
  }

  switchLayer(id: string): void {
    if (!id || id === this.activeLayerId()) return;
    this.stashLayer();
    const layer = this.layers().find((item) => item.id === id);
    if (!layer) return;
    this.activeLayerId.set(id);
    this.applyLayer(layer);
  }

  addLayer(template: LayerTemplate = 'blank'): void {
    if (this.layers().length >= MAX_LAYERS) {
      this.toast.error(`เพิ่มได้สูงสุด ${MAX_LAYERS} เลเยอร์`);
      return;
    }
    this.stashLayer();
    const id = `layer-${Date.now().toString(36)}`;
    const preset = template === 'blank' ? null : LAYER_PRESETS[template];
    const name = preset?.name ?? `Layer ${this.layers().length + 1}`;
    const hidden = preset?.hidden ?? [];
    this.layers.update((layers) => [...layers, { id, name, widgets: {}, hidden }]);
    this.activeLayerId.set(id);
    this.positions.set(null);
    this.savedWidgets.set(null);
    this.hidden.set(hidden);
    this.markDirty();
    if (this.editing()) setTimeout(() => this.captureFlow(), 16);
  }

  /** เพิ่มเลเยอร์จากแม่แบบที่เลือกในดรอปดาวน์ */
  addLayerFromTemplate(value: string): void {
    if (!value) return;
    this.addLayer(value as LayerTemplate);
  }

  duplicateLayer(): void {
    this.stashLayer();
    const active = this.layers().find((layer) => layer.id === this.activeLayerId());
    if (!active) return;
    const id = `layer-${Date.now().toString(36)}`;
    const copy: WorkspaceLayer = {
      id,
      name: `${active.name} (สำเนา)`,
      widgets: JSON.parse(JSON.stringify(active.widgets ?? {})) as Record<string, WorkspaceWidgetPosition>,
      hidden: [...active.hidden],
    };
    this.layers.update((layers) => [...layers, copy]);
    this.activeLayerId.set(id);
    this.applyLayer(copy);
    this.markDirty();
  }

  renameLayer(): void {
    const active = this.layers().find((layer) => layer.id === this.activeLayerId());
    if (!active) return;
    const name = prompt('ชื่อ Layer', active.name);
    if (!name?.trim()) return;
    this.layers.update((layers) => layers.map((layer) => (layer.id === active.id ? { ...layer, name: name.trim().slice(0, 40) } : layer)));
    this.markDirty();
  }

  deleteLayer(id: string): void {
    if (this.layers().length <= 1) {
      this.toast.error('ต้องมีอย่างน้อยหนึ่ง Layer');
      return;
    }
    if (!confirm('ลบ Layer นี้และการจัดวางใน Layer นี้?')) return;
    const remaining = this.layers().filter((layer) => layer.id !== id);
    this.layers.set(remaining);
    if (this.activeLayerId() === id) {
      const next = remaining[0];
      this.activeLayerId.set(next.id);
      this.applyLayer(next);
    }
    this.markDirty();
  }

  private captureFlow(): void {
    if (this.positions()) return;
    const flow = document.querySelector('.ws-flow') as HTMLElement | null;
    if (!flow) return;
    const rect = flow.getBoundingClientRect();
    if (rect.width < 20) return;
    const positions: Record<string, WorkspaceWidgetPosition> = {};
    let order = 0;
    flow.querySelectorAll<HTMLElement>('.ws-widget').forEach((element) => {
      const key = element.dataset['widget'];
      if (!key) return;
      const box = element.getBoundingClientRect();
      positions[key] = {
        x: round(((box.left - rect.left) / rect.width) * 100, 0.01),
        y: Math.round(box.top - rect.top),
        w: round((box.width / rect.width) * 100, 0.01),
        z: order++,
      };
    });
    if (!Object.keys(positions).length) return;
    this.positions.set(positions);
    setTimeout(() => this.measureHeights(), 16);
  }

  private measureHeights(): void {
    const heights: Record<string, number> = {};
    document.querySelectorAll<HTMLElement>('.ws-canvas .ws-widget').forEach((element) => {
      const key = element.dataset['widget'];
      if (key) heights[key] = Math.round(element.getBoundingClientRect().height);
    });
    this.heights.set(heights);
  }

  /**
   * Masonry แบบเดิมถูกแทนด้วย row-grid: การ์ดแถวเดียวกันสูงเท่ากัน
   * และความสูง snap ทีละ 8px ตาม WORKSPACE spec
   */
  private packWidgets(): Record<string, WorkspaceWidgetPosition> | null {
    const canvas = document.querySelector('.ws-canvas') as HTMLElement | null;
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    if (rect.width < 40) return null;
    const heights = this.heights();
    const packed = packWorkspaceRows(
      this.visibleWidgets().map((widget) => ({
        key: widget.key,
        span: widget.span,
        height: heights[widget.key] ?? 260,
      })),
      { width: rect.width },
    );
    return Object.keys(packed).length ? packed : null;
  }

  /** ตรวจความสูงจริงอีกครั้ง ถ้าเนื้อหายืดเกินความสูงแถวให้จัดใหม่หนึ่งรอบ */
  private verifyPacked(): void {
    this.measureHeights();
    const positions = this.positions();
    if (!positions) return;
    const heights = this.heights();
    const needsRepack = this.visibleWidgets().some(
      (widget) => (heights[widget.key] ?? 0) > (positions[widget.key]?.h ?? 0) + 2,
    );
    if (!needsRepack) return;
    const packed = this.packWidgets();
    if (!packed) return;
    this.positions.set(packed);
    this.markDirty();
    setTimeout(() => this.measureHeights(), 16);
  }

  private ensurePosition(key: string): void {
    const positions = this.positions();
    if (!positions || positions[key]) return;
    const widget = this.catalog().find((item) => item.key === key);
    if (!widget) return;
    const bottom = this.canvasHeight();
    const maxZ = Math.max(0, ...Object.values(positions).map((position) => position.z ?? 0));
    this.positions.set({ ...positions, [key]: { x: 0, y: bottom, w: round((widget.span / 12) * 100, 0.5), z: maxZ + 1 } });
    setTimeout(() => this.measureHeights(), 16);
  }

  private ensureVisiblePositions(): void {
    const positions = this.positions();
    if (!positions) return;
    const next = { ...positions };
    let bottom = Math.max(0, ...Object.values(next).map((position) => position.y));
    let maxZ = Math.max(0, ...Object.values(next).map((position) => position.z ?? 0));
    let changed = false;
    for (const widget of this.visibleWidgets()) {
      if (next[widget.key]) continue;
      next[widget.key] = { x: 0, y: bottom + 24, w: round((widget.span / 12) * 100, 0.5), z: ++maxZ };
      bottom += 320;
      changed = true;
    }
    if (!changed) return;
    this.positions.set(next);
    this.savedWidgets.set(next);
  }

  private markDirty(): void {
    this.dirty = true;
    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => void this.flushSave(), 600);
  }

  private async flushSave(): Promise<void> {
    if (this.saveTimer) {
      clearTimeout(this.saveTimer);
      this.saveTimer = undefined;
    }
    const widgets = this.positions() ?? {};
    this.stashLayer();
    this.saving.set(true);
    try {
      const config = await firstValueFrom(
        this.api.put<WorkspaceConfig>('/prefs/workspace', {
          version: 1,
          widgets,
          hidden: this.hidden(),
          layers: this.layers(),
          activeLayerId: this.activeLayerId(),
        }),
      );
      this.savedWidgets.set(this.positions());
      this.savedAt.set(config.updatedAt || new Date().toISOString());
      this.dirty = false;
    } catch (error) {
      this.toast.error(apiErrorMessage(error));
    } finally {
      this.saving.set(false);
    }
  }
}

