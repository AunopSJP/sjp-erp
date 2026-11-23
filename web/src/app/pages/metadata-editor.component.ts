import { ChangeDetectionStrategy, Component, OnInit, computed, inject, input, signal } from '@angular/core';
import { ApiService, apiErrorMessage } from '../core/api.service';
import { AuthService } from '../core/auth.service';
import { MetaService } from '../core/meta.service';
import { IconComponent } from '../shared/icon.component';
import { ModalComponent } from '../shared/modal.component';
import { ToastService } from '../shared/toast.service';
import type { EntityDef, FieldDef, FieldType, RoleRow } from '../core/models';

interface FullConfig {
  entities: Record<string, EntityDef>;
  workflows: Record<string, unknown>;
  lists: { teams: string[]; depts: string[] };
  resources: Record<string, string>;
}

const MODULE_GROUPS = ['ภาพรวม', 'งานบริการและโครงการ', 'จัดซื้อและคลัง', 'บัญชีและการเงิน', 'ข้อมูลหลัก', 'ระบบ'];

const MODULE_ICONS: [string, string][] = [
  ['puzzle', 'ต่อจิ๊กซอว์ (ทั่วไป)'],
  ['box', 'กล่อง / คลัง'],
  ['ticket', 'ตั๋วงาน'],
  ['folder', 'โฟลเดอร์ / โครงการ'],
  ['doc', 'เอกสาร'],
  ['building', 'อาคาร / ลูกค้า'],
  ['wrench', 'งานช่าง / PM'],
  ['chart', 'กราฟ / รายงาน'],
  ['tag', 'ป้าย / Serial'],
  ['receipt', 'ใบเสร็จ / จัดซื้อ'],
  ['user', 'ผู้ใช้ / ผู้ติดต่อ'],
  ['pin', 'ไซต์ / สถานที่'],
  ['calendar', 'ปฏิทิน'],
];

interface ModuleTemplate {
  key: string;
  label: string;
  description: string;
  prefix: string;
  group: string;
  icon: string;
  fields: FieldDef[];
}

const MODULE_TEMPLATES: ModuleTemplate[] = [
  {
    key: 'blank',
    label: 'เริ่มจากศูนย์',
    description: 'โมดูลเปล่าที่มีฟิลด์ชื่อเรื่อง',
    prefix: 'DOC',
    group: '',
    icon: 'puzzle',
    fields: [{ key: 'name', label: 'ชื่อเรื่อง', type: 'text', required: true }],
  },
  {
    key: 'request',
    label: 'คำขออนุมัติ',
    description: 'คำขอทั่วไปพร้อมผู้ขอ ประเภท จำนวนเงิน และกำหนดต้องการ',
    prefix: 'REQ',
    group: 'งานบริการและโครงการ',
    icon: 'doc',
    fields: [
      { key: 'name', label: 'เรื่องที่ขอ', type: 'text', required: true },
      { key: 'requester', label: 'ผู้ขอ', type: 'text', required: true },
      { key: 'requestType', label: 'ประเภทคำขอ', type: 'select', options: ['จัดซื้อ', 'บริการ', 'อื่นๆ'], required: true },
      { key: 'amount', label: 'จำนวนเงิน (บาท)', type: 'number' },
      { key: 'neededBy', label: 'ต้องการภายใน', type: 'date' },
      { key: 'detail', label: 'รายละเอียด', type: 'textarea', required: true },
    ],
  },
  {
    key: 'asset',
    label: 'ทะเบียนอุปกรณ์',
    description: 'ทะเบียนอุปกรณ์/ทรัพย์สินพร้อมผู้ดูแลและวันหมดประกัน',
    prefix: 'AST',
    group: 'ข้อมูลหลัก',
    icon: 'chip',
    fields: [
      { key: 'name', label: 'ชื่ออุปกรณ์', type: 'text', required: true },
      { key: 'assetCode', label: 'รหัสทรัพย์สิน', type: 'text', required: true, unique: true },
      { key: 'category', label: 'หมวด', type: 'select', options: ['คอมพิวเตอร์', 'เครือข่าย', 'ไฟฟ้า', 'อื่นๆ'] },
      { key: 'location', label: 'สถานที่ติดตั้ง', type: 'text' },
      { key: 'owner', label: 'ผู้ดูแล', type: 'ref', ref: 'users' },
      { key: 'receivedDate', label: 'วันที่รับเข้า', type: 'date' },
      { key: 'warrantyEnd', label: 'วันหมดประกัน', type: 'date' },
      { key: 'note', label: 'หมายเหตุ', type: 'textarea' },
    ],
  },
  {
    key: 'survey',
    label: 'ผลสำรวจหน้างาน',
    description: 'บันทึกผลสำรวจไซต์ ผู้สำรวจ สภาพปัญหา และข้อเสนอแนะ',
    prefix: 'SUR',
    group: 'งานบริการและโครงการ',
    icon: 'pin',
    fields: [
      { key: 'name', label: 'หัวข้อการสำรวจ', type: 'text', required: true },
      { key: 'site', label: 'ไซต์งาน', type: 'ref', ref: 'sites', required: true },
      { key: 'surveyDate', label: 'วันที่สำรวจ', type: 'date', required: true },
      { key: 'engineer', label: 'ผู้สำรวจ', type: 'text' },
      { key: 'finding', label: 'สิ่งที่พบ', type: 'textarea', required: true },
      { key: 'recommendation', label: 'ข้อเสนอแนะ', type: 'textarea' },
      { key: 'attachments', label: 'รูปภาพ/เอกสาร', type: 'file' },
    ],
  },
];

const FIELD_TYPES: [FieldType, string][] = [
  ['text', 'ข้อความสั้น'],
  ['textarea', 'ข้อความยาว'],
  ['number', 'ตัวเลข'],
  ['date', 'วันที่'],
  ['datetime', 'วันที่-เวลา'],
  ['select', 'ตัวเลือก'],
  ['multiselect', 'เลือกหลายค่า'],
  ['boolean', 'ใช่/ไม่ใช่'],
  ['ref', 'เชื่อมข้อมูล'],
  ['file', 'ไฟล์แนบ'],
  ['rows', 'ตารางย่อย'],
  ['section', 'หัวข้อคั่น'],
  ['email', 'อีเมล'],
  ['phone', 'โทรศัพท์'],
  ['url', 'ลิงก์'],
];

@Component({
  selector: 'app-metadata-editor',
  standalone: true,
  imports: [ModalComponent, IconComponent],
  template: `
    <div class="meta-page">
      <input #importFile type="file" accept=".json,application/json" hidden (change)="importSchema($event)" />

      <div class="meta-workbench">
        <aside class="meta-module-list" aria-label="รายการโมดูล">
          <div class="meta-module-list-head">
            <div><b>โมดูล</b><span>{{ entities().length }} รายการ</span></div>
            @if (auth.can('settings','edit')) {
              <button type="button" class="btn primary sm" (click)="openCreate()">+ สร้าง</button>
            }
          </div>
          <div class="meta-module-search">
            <app-icon name="search" [size]="15" />
            <input
              type="search"
              [value]="moduleQuery()"
              (input)="moduleQuery.set($any($event.target).value)"
              placeholder="ค้นหาโมดูล…"
              aria-label="ค้นหาโมดูล"
            />
          </div>
          <div class="meta-module-scroll">
            @if (filteredEditableModules().length) {
              <div class="meta-module-group-label">แก้ไขได้ <span>{{ filteredEditableModules().length }}</span></div>
              @for (entity of filteredEditableModules(); track entity.key) {
                <button type="button" class="meta-module-item" [class.active]="entity.key === selectedKey()" (click)="chooseModule(entity.key)">
                  <span class="mm-ic"><app-icon [name]="entity.icon || 'doc'" [size]="16" /></span>
                  <span class="mm-main"><b>{{ entity.label }}</b><small>{{ entity.prefix }} · {{ entity.fields.length }} ฟิลด์</small></span>
                  @if (entity.custom) { <span class="mm-tag">สร้างเอง</span> }
                </button>
              }
            }
            @if (filteredSystemModules().length) {
              <div class="meta-module-group-label">โมดูลระบบ <span>{{ filteredSystemModules().length }}</span></div>
              @for (entity of filteredSystemModules(); track entity.key) {
                <button type="button" class="meta-module-item" [class.active]="entity.key === selectedKey()" (click)="chooseModule(entity.key)">
                  <span class="mm-ic"><app-icon [name]="entity.icon || 'doc'" [size]="16" /></span>
                  <span class="mm-main"><b>{{ entity.label }}</b><small>{{ entity.prefix }} · {{ entity.fields.length }} ฟิลด์</small></span>
                  <span class="mm-tag system">ระบบ</span>
                </button>
              }
            }
            @if (!filteredEditableModules().length && !filteredSystemModules().length) {
              <div class="meta-module-empty">ไม่พบโมดูลที่ตรงกับ “{{ moduleQuery() }}”</div>
            }
          </div>
          @if (auth.can('settings','edit')) {
            <div class="meta-module-list-foot">
              <span class="meta-module-hint">เลื่อนแนวนอนเพื่อดูโมดูลเพิ่ม →</span>
              <button type="button" class="btn sm" (click)="importFile.click()">นำเข้า JSON</button>
            </div>
          }
        </aside>

        <section class="meta-editor">
          @if (draft(); as d) {
            <div class="meta-editor-head">
              <span class="meta-editor-ic"><app-icon [name]="d.icon || 'doc'" [size]="20" /></span>
              <div class="meta-editor-title">
                <h2>{{ d.label }}</h2>
                <span>{{ d.prefix }} · {{ d.fields.length }} ฟิลด์ · {{ d.custom ? 'สร้างเอง' : (d.system ? 'โมดูลระบบ' : 'โมดูลมาตรฐาน') }}
                  @if (d.custom) { · <b class="badge {{ (d.status || 'published') === 'published' ? 'green' : (d.status === 'archived' ? 'gray' : 'amber') }}">{{ statusLabel(d) }}</b> }
                </span>
              </div>
              <span class="grow"></span>
              @if (d.custom && auth.can('settings','edit')) {
                @if ((d.status || 'published') !== 'published') {
                  <button type="button" class="btn sm primary" [disabled]="saving()" (click)="setModuleStatus('published')">เผยแพร่</button>
                }
                @if ((d.status || 'published') !== 'draft') {
                  <button type="button" class="btn sm" [disabled]="saving()" (click)="setModuleStatus('draft')">ย้ายเป็นร่าง</button>
                }
                @if ((d.status || 'published') !== 'archived') {
                  <button type="button" class="btn sm danger" [disabled]="saving()" (click)="setModuleStatus('archived')">เก็บถาวร</button>
                }
              }
              @if (d.custom) {
                <button type="button" class="btn sm" (click)="duplicateModule()">ทำสำเนา</button>
                <button type="button" class="btn sm" (click)="exportModule()">ส่งออก</button>
                <button type="button" class="btn sm danger" (click)="removeModule()">ลบ</button>
              } @else if (d.system) {
                <span class="badge gray">อ่านอย่างเดียว</span>
              }
            </div>

            @if (d.system) {
              <div class="notice warn">โมดูลระบบ — ดูโครงสร้างได้ แต่แก้ไขไม่ได้</div>
            }

            <div class="tabs" role="group" aria-label="ส่วนของโมดูล">
              <button type="button" [attr.aria-pressed]="tab() === 'info'" [class.active]="tab() === 'info'" (click)="tab.set('info')">ข้อมูลโมดูล</button>
              <button type="button" [attr.aria-pressed]="tab() === 'fields'" [class.active]="tab() === 'fields'" (click)="tab.set('fields')">ฟิลด์ <span class="tab-count">{{ d.fields.length }}</span></button>
              <button type="button" [attr.aria-pressed]="tab() === 'views'" [class.active]="tab() === 'views'" (click)="tab.set('views')">มุมมองรายการ</button>
            </div>

            <fieldset class="meta-fieldset" [disabled]="readOnly()">
              @if (tab() === 'info') {
                <section class="meta-panel">
                  <div class="meta-panel-head">
                    <div><h3>ข้อมูลโมดูล</h3><p>ชื่อที่แสดง รูปแบบเลขที่ และการจัดเมนู</p></div>
                  </div>
                  <div class="meta-panel-body meta-grid meta-grid-2">
                    <div class="field"><label for="lf-metadata-editor-component-1">ชื่อโมดูล/เอกสาร *</label><input id="lf-metadata-editor-component-1" [value]="d.label" maxlength="60" (input)="set('label', $any($event.target).value)" /></div>
                    <div class="field"><label for="lf-metadata-editor-component-2">ชื่อเมนูสั้น (sidebar)</label><input id="lf-metadata-editor-component-2" [value]="d.navLabel || ''" maxlength="40" placeholder="ถ้าว่างจะใช้ชื่อโมดูล" (input)="set('navLabel', $any($event.target).value)" /></div>
                    <div class="field"><label for="lf-metadata-editor-component-3">Prefix เลขที่</label><input id="lf-metadata-editor-component-3" [value]="d.prefix" (input)="set('prefix', $any($event.target).value.toUpperCase())" maxlength="8" /></div>
                    <div class="field">
                      <label for="lf-metadata-editor-component-4">ฟิลด์ที่ใช้เป็นชื่อรายการ</label>
                      <select id="lf-metadata-editor-component-4" [value]="d.title" (change)="set('title', $any($event.target).value)">
                        @for (field of d.fields; track field.key) { <option [value]="field.key" [selected]="field.key === d.title">{{ field.label }}</option> }
                        <option value="code" [selected]="d.title === 'code'">รหัสเอกสาร</option>
                      </select>
                    </div>
                    <div class="field">
                      <label for="lf-metadata-editor-component-5">หมวดเมนู</label>
                      <select id="lf-metadata-editor-component-5" [value]="d.group || ''" (change)="set('group', $any($event.target).value)">
                        <option value="" [selected]="!d.group">โมดูลของฉัน</option>
                        @for (group of moduleGroups; track group) { <option [value]="group" [selected]="group === d.group">{{ group }}</option> }
                      </select>
                    </div>
                    <div class="field">
                      <label for="lf-metadata-editor-component-6">ไอคอนเมนู</label>
                      <select id="lf-metadata-editor-component-6" [value]="d.icon || 'puzzle'" (change)="set('icon', $any($event.target).value)">
                        @for (icon of moduleIcons; track icon[0]) { <option [value]="icon[0]" [selected]="icon[0] === (d.icon || 'puzzle')">{{ icon[1] }}</option> }
                      </select>
                    </div>
                    <div class="field wide"><label for="lf-metadata-editor-component-7">คำอธิบาย</label><input id="lf-metadata-editor-component-7" [value]="d.description || ''" (input)="set('description', $any($event.target).value)" placeholder="อธิบายว่าโมดูลนี้ใช้ทำอะไร" /></div>
                    <div class="field wide">
                      <label for="lf-metadata-editor-component-7b">คำค้นเพิ่มเติม (alias) — คั่นด้วย ,</label>
                      <input id="lf-metadata-editor-component-7b" [value]="(d.aliases || []).join(', ')" (input)="setAliases($any($event.target).value)" placeholder="เช่น ใบสั่งซื้อ, PO, purchase order" />
                      <div class="muted small">ใช้ค้นหาใน App Launcher และช่องค้นหาระบบ; เว้นว่างได้</div>
                    </div>
                    <label class="meta-toggle wide">
                      <input type="checkbox" [checked]="!!d.scoped" (change)="set('scoped', $any($event.target).checked)" />
                      <span><b>จำกัดข้อมูลตาม scope</b><small>ผู้ใช้เห็นเฉพาะข้อมูลที่ได้รับสิทธิ์</small></span>
                    </label>
                  </div>
                </section>

                @if (d.custom) {
                  <section class="meta-panel">
                    <div class="meta-panel-head">
                      <div><h3>การเข้าถึงของบทบาท</h3><p>เลือกบทบาทที่เห็นและใช้งานโมดูลนี้ — ผู้ดูแลระบบเห็นทั้งหมดเสมอ</p></div>
                    </div>
                    <div class="meta-panel-body">
                      @if (roles().length) {
                        <div class="meta-checks">
                          @for (role of roles(); track role.id) {
                            @if (!role.isAdmin) {
                              <label class="meta-check" [class.on]="draftRoleIds().includes(role.id)">
                                <input type="checkbox" [checked]="draftRoleIds().includes(role.id)" (change)="toggleDraftRole(role.id, $any($event.target).checked)" />
                                <span>{{ role.name }}</span>
                              </label>
                            }
                          }
                        </div>
                      } @else {
                        <p class="muted small">ไม่พบบทบาทที่แก้ไขได้ หรือคุณไม่มีสิทธิ์ดูบทบาท</p>
                      }
                    </div>
                  </section>
                }

                <details class="meta-advanced">
                  <summary>ตัวเลือกกลาง: ทีมและแผนก <span>ใช้ร่วมทุกโมดูล</span></summary>
                  <div class="meta-advanced-body">
                    <div class="meta-grid meta-grid-2">
                      <div class="field"><label for="lf-metadata-editor-component-8">ทีม (บรรทัดละ 1)</label><textarea id="lf-metadata-editor-component-8" rows="4" [value]="teams()" (input)="teams.set($any($event.target).value)"></textarea></div>
                      <div class="field"><label for="lf-metadata-editor-component-9">แผนก (บรรทัดละ 1)</label><textarea id="lf-metadata-editor-component-9" rows="4" [value]="depts()" (input)="depts.set($any($event.target).value)"></textarea></div>
                    </div>
                    <div class="meta-advanced-actions">
                      <button type="button" class="btn sm" (click)="saveLists()">บันทึกทีม/แผนก</button>
                    </div>
                  </div>
                </details>
              }

              @if (tab() === 'fields') {
                <section class="meta-panel">
                  <div class="meta-panel-head">
                    <div><h3>ฟิลด์ ({{ d.fields.length }})</h3><p>เพิ่ม แก้ไข และจัดลำดับฟิลด์ที่ใช้ในฟอร์มและตาราง</p></div>
                    @if (!readOnly()) {
                      <button type="button" class="btn" (click)="openNewField()">+ เพิ่มฟิลด์</button>
                    }
                  </div>
                  @if (!d.fields.length) {
                    <div class="meta-field-empty">
                      <b>ยังไม่มีฟิลด์</b>
                      <span>เริ่มจากฟิลด์ชื่อเรื่อง แล้วค่อยเพิ่มฟิลด์อื่น</span>
                      @if (!readOnly()) { <button type="button" class="btn primary sm" (click)="openNewField()">+ เพิ่มฟิลด์แรก</button> }
                    </div>
                  } @else {
                    <div class="meta-field-list">
                      @for (field of d.fields; track field.key; let i = $index) {
                        <div
                          class="meta-field-row"
                          [class.dragging]="dragIndex() === i"
                          [class.drag-over]="dragOverIndex() === i && dragIndex() !== i"
                          [attr.draggable]="readOnly() ? null : 'true'"
                          (dragstart)="dragStart(i, $event)"
                          (dragover)="dragOver(i, $event)"
                          (drop)="dropField(i, $event)"
                          (dragend)="dragEnd()"
                        >
                          <span class="mf-order">
                            <span class="drag-handle" title="ลากเพื่อจัดลำดับ">⠿</span>
                            <button type="button" class="mf-move" [disabled]="i === 0 || readOnly()" (click)="moveField(i, -1)" title="เลื่อนขึ้น">↑</button>
                            <button type="button" class="mf-move" [disabled]="i === d.fields.length - 1 || readOnly()" (click)="moveField(i, 1)" title="เลื่อนลง">↓</button>
                          </span>
                          <div class="mf-main">
                            <b>{{ field.label || '(ยังไม่ตั้งชื่อ)' }}</b>
                            <span class="mf-key">{{ field.key }}</span>
                            @if (fieldSummary(field)) { <span class="mf-summary">{{ fieldSummary(field) }}</span> }
                          </div>
                          <span class="mf-badges">
                            <span class="badge gray">{{ fieldTypeLabel(field.type) }}</span>
                            <span class="mf-flags">
                              @if (field.required) { <span class="mf-flag">บังคับ</span> }
                              @if (field.hidden) { <span class="mf-flag muted">ซ่อน</span> }
                              @if (field.unique) { <span class="mf-flag">ห้ามซ้ำ</span> }
                              @if (field.readOnly) { <span class="mf-flag">อ่านอย่างเดียว</span> }
                            </span>
                          </span>
                          <span class="mf-actions">
                            <button type="button" class="btn sm" (click)="openFieldEditor(i)" [disabled]="readOnly()">แก้ไข</button>
                            <button type="button" class="row-del" (click)="removeField(i)" [disabled]="readOnly()" aria-label="ลบฟิลด์" title="ลบฟิลด์">×</button>
                          </span>
                        </div>
                      }
                    </div>
                  }
                </section>
              }

              @if (tab() === 'views') {
                <section class="meta-panel">
                  <div class="meta-panel-head">
                    <div><h3>มุมมองรายการ</h3><p>เลือกคอลัมน์ที่แสดงในตาราง และตัวกรองที่ใช้บ่อย</p></div>
                  </div>
                  <div class="meta-panel-body meta-grid meta-grid-2">
                    <div class="meta-group">
                      <div class="meta-group-head"><b>คอลัมน์ในตาราง</b><span>{{ d.cols.length }} เลือก</span></div>
                      <div class="meta-checks">
                        @for (option of columnOptions(); track option.key) {
                          <label class="meta-check" [class.on]="hasCol(option.key)">
                            <input type="checkbox" [checked]="hasCol(option.key)" (change)="toggleCol(option.key, $any($event.target).checked)" />
                            <span>{{ option.label }}</span>
                          </label>
                        }
                      </div>
                    </div>
                    <div class="meta-group">
                      <div class="meta-group-head"><b>ตัวกรองในหน้ารายการ</b><span>{{ d.filters.length }} เลือก</span></div>
                      <div class="meta-checks">
                        @for (option of filterOptions(); track option.key) {
                          <label class="meta-check" [class.on]="hasFilter(option.key)">
                            <input type="checkbox" [checked]="hasFilter(option.key)" (change)="toggleFilter(option.key, $any($event.target).checked)" />
                            <span>{{ option.label }}</span>
                          </label>
                        }
                      </div>
                    </div>
                  </div>
                </section>
              }
            </fieldset>

            <div class="meta-savebar">
              @if (draftMessage()) { <span class="err">{{ draftMessage() }}</span> }
              @if (dirty()) { <span class="meta-unsaved">มีการแก้ไขที่ยังไม่บันทึก</span> }
              <span class="grow"></span>
              @if (readOnly()) {
                <span class="muted small">โมดูลนี้แก้ไขไม่ได้</span>
              } @else {
                <button type="button" class="btn primary" [disabled]="saving()" (click)="save()">{{ saving() ? 'กำลังบันทึก…' : 'บันทึกโครงสร้าง' }}</button>
              }
            </div>
          } @else {
            <div class="state empty">เลือกโมดูลจากรายการด้านซ้าย</div>
          }
        </section>
      </div>
    </div>
    @if (newOpen()) {
      <app-modal title="สร้างโมดูลใหม่" [wide]="true" (closed)="newOpen.set(false)">
        <div class="field" style="margin-bottom:10px">
          <label for="lf-metadata-editor-component-10">เริ่มจากแม่แบบ</label>
          <select id="lf-metadata-editor-component-10" [value]="newTemplate()" (change)="applyTemplate($any($event.target).value)">
            @for (template of moduleTemplates; track template.key) {
              <option [value]="template.key" [selected]="template.key === newTemplate()">{{ template.label }}</option>
            }
          </select>
          <div class="muted small" style="margin-top:4px">{{ newTemplateInfo().description }}</div>
        </div>
        <div class="form-grid">
          <div class="field"><label for="lf-metadata-editor-component-11">ชื่อโมดูล *</label><input id="lf-metadata-editor-component-11" [value]="newModule().label" maxlength="60" (input)="setNew('label', $any($event.target).value)" /></div>
          <div class="field"><label for="lf-metadata-editor-component-12">ชื่อเมนูสั้น (sidebar)</label><input id="lf-metadata-editor-component-12" [value]="newModule().navLabel" maxlength="40" (input)="setNew('navLabel', $any($event.target).value)" placeholder="ถ้าว่างจะใช้ชื่อโมดูล" /></div>
          <div class="field"><label for="lf-metadata-editor-component-13">key (a-z, 0-9, _) *</label><input id="lf-metadata-editor-component-13" [value]="newModule().key" (input)="setNew('key', $any($event.target).value)" /></div>
          <div class="field"><label for="lf-metadata-editor-component-14">Prefix เลขที่</label><input id="lf-metadata-editor-component-14" [value]="newModule().prefix" (input)="setNew('prefix', $any($event.target).value.toUpperCase())" maxlength="8" /></div>
          <div class="field">
            <label for="lf-metadata-editor-component-15">หมวดเมนู</label>
            <select id="lf-metadata-editor-component-15" [value]="newModule().group" (change)="setNew('group', $any($event.target).value)">
              <option value="" [selected]="!newModule().group">โมดูลของฉัน</option>
              @for (group of moduleGroups; track group) { <option [value]="group" [selected]="group === newModule().group">{{ group }}</option> }
            </select>
          </div>
          <div class="field">
            <label for="lf-metadata-editor-component-16b">สถานะเมื่อสร้าง</label>
            <select id="lf-metadata-editor-component-16b" [value]="newStatus()" (change)="newStatus.set($any($event.target).value)">
              <option value="draft" [selected]="newStatus() === 'draft'">ร่าง (ซ่อนจากเมนูจนเผยแพร่)</option>
              <option value="published" [selected]="newStatus() === 'published'">เผยแพร่ทันที</option>
            </select>
          </div>
          <div class="field">
            <label for="lf-metadata-editor-component-16">ไอคอนเมนู</label>
            <select id="lf-metadata-editor-component-16" [value]="newModule().icon" (change)="setNew('icon', $any($event.target).value)">
              @for (icon of moduleIcons; track icon[0]) { <option [value]="icon[0]" [selected]="icon[0] === newModule().icon">{{ icon[1] }}</option> }
            </select>
          </div>
          <div class="field"><label for="lf-metadata-editor-component-17">คำอธิบาย</label><input id="lf-metadata-editor-component-17" [value]="newModule().description" (input)="setNew('description', $any($event.target).value)" placeholder="โมดูลนี้ใช้ทำอะไร" /></div>
        </div>
        <div class="field"><label>ให้สิทธิ์ดู/สร้าง/แก้ไข (ไม่บังคับ)</label><div class="meta-checks">@for (role of roles(); track role.id) { @if (!role.isAdmin) { <label class="meta-check" [class.on]="newRoleIds().includes(role.id)"><input type="checkbox" [checked]="newRoleIds().includes(role.id)" (change)="toggleRole(role.id, $any($event.target).checked)" /><span>{{ role.name }}</span></label> } }</div></div>
        @if (newError()) { <div class="err">{{ newError() }}</div> }
        <div modal-footer><button type="button" class="btn" (click)="newOpen.set(false)">ยกเลิก</button><button type="button" class="btn primary" [disabled]="newBusy()" (click)="createModule()">สร้างโมดูล</button></div>
      </app-modal>
    }

    @if (fieldDraft(); as field) {
      <app-modal [title]="fieldEditIndex() === null ? 'เพิ่มฟิลด์' : 'แก้ไขฟิลด์: ' + field.label" [wide]="true" (closed)="closeFieldEditor()">
        <div class="form-grid">
          <div class="field"><label for="lf-metadata-editor-component-18">ชื่อฟิลด์ *</label><input id="lf-metadata-editor-component-18" [value]="field.label" (input)="setFieldDraft('label', $any($event.target).value)" placeholder="เช่น วันที่เริ่มใช้งาน" /></div>
          <div class="field"><label for="lf-metadata-editor-component-19">key *</label><input id="lf-metadata-editor-component-19" [value]="field.key" [disabled]="fieldEditIndex() !== null && originalKeys().has(field.key)" (input)="setFieldDraft('key', $any($event.target).value)" /><div class="muted small" style="display:flex;align-items:center;gap:6px">ใช้เป็นชื่อฟิลด์ใน API/ข้อมูล@if (fieldEditIndex() !== null && originalKeys().has(field.key)) { <button type="button" class="btn ghost sm" (click)="renameFromField()">เปลี่ยน key</button> }</div></div>
          <div class="field">
            <label for="lf-metadata-editor-component-20">ชนิด</label>
            <select id="lf-metadata-editor-component-20" [value]="field.type" (change)="setFieldDraft('type', $any($event.target).value)">
              @for (type of fieldTypes; track type[0]) { <option [value]="type[0]" [selected]="type[0] === field.type">{{ type[1] }}</option> }
            </select>
          </div>
          <div class="field"><label for="lf-metadata-editor-component-21">คำอธิบายช่วยกรอก (tooltip)</label><input id="lf-metadata-editor-component-21" [value]="field.help || ''" (input)="setFieldDraft('help', $any($event.target).value)" placeholder="อธิบายวิธีกรอก" /></div>
          <div class="field"><label for="lf-metadata-editor-component-22">หน่วย/ suffix</label><input id="lf-metadata-editor-component-22" [value]="field.suffix || ''" (input)="setFieldDraft('suffix', $any($event.target).value)" placeholder="เช่น บาท, ชม." /></div>
          @if (field.type === 'select' || field.type === 'multiselect') {
            <div class="field wide"><label for="lf-metadata-editor-component-23">ตัวเลือก (คั่นด้วย ,) *</label><input id="lf-metadata-editor-component-23" [value]="fieldOptionsText()" (input)="fieldOptionsText.set($any($event.target).value)" placeholder="ตัวเลือก 1, ตัวเลือก 2" /></div>
          }
          @if (field.type === 'ref') {
            <div class="field wide">
              <label for="lf-metadata-editor-component-24">เชื่อมไปยังโมดูล *</label>
              <select id="lf-metadata-editor-component-24" [value]="field.ref || ''" (change)="setFieldDraft('ref', $any($event.target).value)">
                <option value="" [selected]="!field.ref">– เลือก –</option>
                @for (entity of entities(); track entity.key) { <option [value]="entity.key" [selected]="entity.key === field.ref">{{ entity.label }}</option> }
                <option value="users" [selected]="field.ref === 'users'">ผู้ใช้</option>
              </select>
            </div>
          }
        </div>
        <div class="meta-flags-grid">
          <label class="check"><input type="checkbox" [checked]="!!field.required" (change)="setFieldDraft('required', $any($event.target).checked)" /> บังคับกรอก</label>
          <label class="check"><input type="checkbox" [checked]="!!field.hidden" (change)="setFieldDraft('hidden', $any($event.target).checked)" /> ซ่อนในฟอร์ม</label>
          <label class="check"><input type="checkbox" [checked]="!!field.unique" (change)="setFieldDraft('unique', $any($event.target).checked)" /> ห้ามซ้ำ</label>
          <label class="check"><input type="checkbox" [checked]="!!field.readOnly" (change)="setFieldDraft('readOnly', $any($event.target).checked)" /> อ่านอย่างเดียว</label>
          <label class="check"><input type="checkbox" [checked]="!!field.wide" (change)="setFieldDraft('wide', $any($event.target).checked)" /> กว้างเต็มแถว</label>
        </div>
        <div modal-footer>
          <button type="button" class="btn" (click)="closeFieldEditor()">ยกเลิก</button>
          <button type="button" class="btn primary" (click)="saveFieldEditor()">{{ fieldEditIndex() === null ? 'เพิ่มฟิลด์' : 'ใช้การตั้งค่านี้' }}</button>
        </div>
      </app-modal>
    }

    @if (renameTarget(); as field) {
      <app-modal title="เปลี่ยน key ฟิลด์" (closed)="closeRename()">
        <div class="notice warn">
          การเปลี่ยน key จะบันทึกทันทีและย้ายข้อมูลเดิมทั้งหมดไปยัง key ใหม่ — การแก้ไขอื่นที่ยังไม่บันทึกจะถูกโหลดใหม่
        </div>
        <div class="form-grid">
          <div class="field"><label for="lf-metadata-editor-component-25">ฟิลด์</label><input id="lf-metadata-editor-component-25" [value]="field.label" disabled /></div>
          <div class="field"><label for="lf-metadata-editor-component-26">key เดิม</label><input id="lf-metadata-editor-component-26" [value]="field.key" disabled /></div>
          <div class="field"><label for="lf-metadata-editor-component-27">key ใหม่ *</label><input id="lf-metadata-editor-component-27" [value]="renameValue()" (input)="renameValue.set($any($event.target).value.trim())" placeholder="new_field_key" /></div>
        </div>
        <p class="muted small">ระบบจะย้ายข้อมูลใน records, คอลัมน์ตาราง, ตัวกรอง, เงื่อนไขแสดงผล, สูตรคำนวณ และฟิลด์บังคับใน workflow ให้อัตโนมัติ</p>
        @if (renameError()) { <div class="err">{{ renameError() }}</div> }
        <div modal-footer>
          <button type="button" class="btn" (click)="closeRename()">ยกเลิก</button>
          <button type="button" class="btn primary" [disabled]="renameBusy() || !renameValue() || renameValue() === field.key" (click)="renameField()">
            {{ renameBusy() ? 'กำลังเปลี่ยน…' : 'เปลี่ยน key' }}
          </button>
        </div>
      </app-modal>
    }

  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class MetadataEditorComponent implements OnInit {
  readonly auth = inject(AuthService);
  private readonly meta = inject(MetaService);
  private readonly api = inject(ApiService);
  private readonly toast = inject(ToastService);

  readonly config = signal<FullConfig | null>(null);
  readonly selectedKey = signal('');
  readonly draft = signal<EntityDef | null>(null);
  readonly originalKeys = signal<Set<string>>(new Set());
  readonly saving = signal(false);
  readonly draftMessage = signal('');
  readonly roles = signal<RoleRow[]>([]);
  readonly startCreating = input(false);
  readonly newOpen = signal(false);
  readonly newBusy = signal(false);
  readonly newError = signal('');
  readonly newModule = signal({ label: '', key: '', prefix: 'DOC', group: '', navLabel: '', icon: 'puzzle', description: '' });
  readonly newTemplate = signal('blank');
  readonly newFieldsOverride = signal<FieldDef[] | null>(null);
  readonly newRoleIds = signal<string[]>([]);
  readonly draftRoleIds = signal<string[]>([]);
  readonly moduleGroups = MODULE_GROUPS;
  readonly moduleIcons = MODULE_ICONS;
  readonly moduleTemplates = MODULE_TEMPLATES;
  readonly newTemplateInfo = computed(() => this.moduleTemplates.find((template) => template.key === this.newTemplate()) ?? this.moduleTemplates[0]);
  readonly newStatus = signal<'draft' | 'published'>('draft');
  readonly teams = signal('');
  readonly depts = signal('');
  readonly fieldTypes = FIELD_TYPES;
  readonly dragIndex = signal<number | null>(null);
  readonly dragOverIndex = signal<number | null>(null);
  readonly renameIndex = signal<number | null>(null);
  readonly renameValue = signal('');
  readonly renameBusy = signal(false);
  readonly renameError = signal('');
  readonly fieldEditIndex = signal<number | null>(null);
  readonly fieldDraft = signal<FieldDef | null>(null);
  readonly fieldOptionsText = signal('');
  readonly tab = signal<'info' | 'fields' | 'views'>('fields');
  readonly moduleQuery = signal('');
  readonly originalJson = signal('');
  readonly renameTarget = computed(() => {
    const draft = this.draft();
    const index = this.renameIndex();
    if (!draft || index === null) return null;
    return draft.fields[index] ?? null;
  });

  readonly entities = computed(() => Object.values(this.config()?.entities ?? {}).sort((a, b) => a.label.localeCompare(b.label, 'th')));
  readonly editableModules = computed(() =>
    this.entities()
      .filter((entity) => !entity.system)
      .sort((a, b) => Number(!!b.custom) - Number(!!a.custom) || a.label.localeCompare(b.label, 'th')),
  );
  readonly systemModules = computed(() => this.entities().filter((entity) => entity.system));
  readonly filteredEditableModules = computed(() => this.filterModules(this.editableModules()));
  readonly filteredSystemModules = computed(() => this.filterModules(this.systemModules()));
  readonly readOnly = computed(() => !this.auth.can('settings', 'edit') || !!this.draft()?.system);
  readonly dirty = computed(() => {
    const draft = this.draft();
    if (!draft || !this.originalJson()) return false;
    if (JSON.stringify(draft) !== this.originalJson()) return true;
    if (!draft.custom || !this.roles().length) return false;
    const selected = new Set(this.draftRoleIds());
    return this.roles().some(
      (role) => !role.isAdmin && !!role.perms?.[draft.key]?.['view'] !== selected.has(role.id),
    );
  });
  readonly columnOptions = computed(() => {
    const draft = this.draft();
    if (!draft) return [] as { key: string; label: string }[];
    const options = [{ key: 'code', label: 'รหัสเอกสาร' }];
    for (const field of draft.fields) {
      if (field.type === 'section') continue;
      if (!options.some((option) => option.key === field.key)) options.push({ key: field.key, label: field.label });
    }
    if (this.workflowStatuses(draft).length && !options.some((option) => option.key === 'status')) {
      options.push({ key: 'status', label: 'สถานะ' });
    }
    return options;
  });
  readonly filterOptions = computed(() => {
    const draft = this.draft();
    if (!draft) return [] as { key: string; label: string }[];
    const options = draft.fields
      .filter((field) => !['section', 'rows', 'file'].includes(field.type))
      .map((field) => ({ key: field.key, label: field.label }));
    if (this.workflowStatuses(draft).length) options.unshift({ key: 'status', label: 'สถานะ' });
    return options;
  });

  ngOnInit(): void {
    this.load();
    this.loadRoles();
    if (this.startCreating() && this.auth.can('settings', 'edit')) this.openCreate();
  }

  private loadRoles(): void {
    this.api.get<RoleRow[]>('/roles').subscribe({
      next: (roles) => {
        this.roles.set(roles);
        this.syncDraftRoles();
      },
      error: () => this.roles.set([]),
    });
  }

  load(): void {
    this.api.get<FullConfig>('/meta/config').subscribe({
      next: (config) => {
        this.config.set(config);
        const first = this.selectedKey() && config.entities[this.selectedKey()] ? this.selectedKey() : Object.keys(config.entities)[0];
        if (first) this.select(first);
        this.teams.set((config.lists.teams ?? []).join('\n'));
        this.depts.set((config.lists.depts ?? []).join('\n'));
      },
      error: (error: unknown) => this.toast.error(apiErrorMessage(error)),
    });
  }

  select(key: string): void {
    const entity = this.config()?.entities[key];
    if (!entity) return;
    this.selectedKey.set(key);
    this.draft.set(JSON.parse(JSON.stringify(entity)));
    this.originalKeys.set(new Set(entity.fields.map((field) => field.key)));
    this.originalJson.set(JSON.stringify(entity));
    this.draftMessage.set('');
    this.syncDraftRoles();
  }

  chooseModule(key: string): void {
    if (key === this.selectedKey()) return;
    if (this.dirty() && !confirm('มีการแก้ไขที่ยังไม่บันทึก — เปลี่ยนโมดูลและทิ้งการแก้ไขหรือไม่?')) return;
    this.select(key);
  }

  private filterModules(modules: EntityDef[]): EntityDef[] {
    const query = this.moduleQuery().trim().toLowerCase();
    if (!query) return modules;
    return modules.filter((entity) =>
      `${entity.label} ${entity.navLabel ?? ''} ${entity.key} ${entity.prefix}`.toLowerCase().includes(query),
    );
  }

  private syncDraftRoles(): void {
    const key = this.draft()?.key;
    if (!key) {
      this.draftRoleIds.set([]);
      return;
    }
    this.draftRoleIds.set(
      this.roles()
        .filter((role) => !role.isAdmin && !!role.perms?.[key]?.['view'])
        .map((role) => role.id),
    );
  }

  toggleDraftRole(id: string, checked: boolean): void {
    this.draftRoleIds.update((ids) => (checked ? [...new Set([...ids, id])] : ids.filter((roleId) => roleId !== id)));
  }

  set(key: keyof EntityDef, value: unknown): void {
    this.draft.update((draft) => (draft ? { ...draft, [key]: value } : draft));
  }

  setAliases(value: string): void {
    const aliases = value
      .split(/[,\n]/)
      .map((item) => item.trim().replace(/\s+/g, ' '))
      .filter(Boolean)
      .slice(0, 20);
    this.set('aliases', [...new Set(aliases)]);
  }

  setField(index: number, key: keyof FieldDef, value: unknown): void {
    this.draft.update((draft) => {
      if (!draft) return draft;
      const fields = draft.fields.map((field, i) => (i === index ? { ...field, [key]: value } : field));
      return { ...draft, fields };
    });
  }

  setOptions(index: number, value: string): void {
    this.setField(index, 'options', value.split(',').map((item) => item.trim()).filter((item) => item.length > 0));
  }

  hasCol(key: string): boolean {
    return (this.draft()?.cols ?? []).includes(key);
  }

  toggleCol(key: string, checked: boolean): void {
    this.draft.update((draft) => {
      if (!draft) return draft;
      const cols = checked
        ? [...draft.cols.filter((col) => col !== key), key]
        : draft.cols.filter((col) => col !== key);
      return { ...draft, cols };
    });
  }

  hasFilter(key: string): boolean {
    return (this.draft()?.filters ?? []).includes(key);
  }

  toggleFilter(key: string, checked: boolean): void {
    this.draft.update((draft) => {
      if (!draft) return draft;
      const filters = checked
        ? [...draft.filters.filter((filter) => filter !== key), key]
        : draft.filters.filter((filter) => filter !== key);
      return { ...draft, filters };
    });
  }

  private workflowStatuses(draft: EntityDef): { key: string }[] {
    const key = draft.workflowKey ?? draft.key;
    const workflow = this.config()?.workflows[key] as { statuses?: { key: string }[] } | undefined;
    return workflow?.statuses ?? [];
  }

  changeType(index: number, type: FieldType): void {
    this.draft.update((draft) => {
      if (!draft) return draft;
      const fields = draft.fields.map((field, i) => {
        if (i !== index) return field;
        const next: FieldDef = { ...field, type };
        if (type === 'select') next.options = field.options?.length ? field.options : ['ตัวเลือก 1'];
        if (type === 'rows' && !field.cols?.length) next.cols = [{ key: 'c1', label: 'รายการ', type: 'text' }];
        return next;
      });
      return { ...draft, fields };
    });
  }

  addField(): void {
    this.openNewField();
  }

  openNewField(): void {
    const draft = this.draft();
    if (!draft || this.readOnly()) return;
    let n = draft.fields.length + 1;
    while (draft.fields.some((field) => field.key === `field${n}`)) n++;
    this.fieldEditIndex.set(null);
    this.fieldDraft.set({ key: `field${n}`, label: '', type: 'text' });
    this.fieldOptionsText.set('');
  }

  removeField(index: number): void {
    if (!confirm('ลบฟิลด์นี้ออกจากแบบฟอร์ม?')) return;
    this.draft.update((draft) => (draft ? { ...draft, fields: draft.fields.filter((_, i) => i !== index) } : draft));
  }

  dragStart(index: number, event: DragEvent): void {
    this.dragIndex.set(index);
    this.dragOverIndex.set(index);
    if (event.dataTransfer) {
      event.dataTransfer.effectAllowed = 'move';
      event.dataTransfer.setData('text/plain', String(index));
    }
  }

  dragOver(index: number, event: DragEvent): void {
    if (this.dragIndex() === null) return;
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
    this.dragOverIndex.set(index);
  }

  dropField(index: number, event: DragEvent): void {
    event.preventDefault();
    const from = this.dragIndex();
    if (from === null || from === index) {
      this.dragEnd();
      return;
    }
    this.draft.update((draft) => {
      if (!draft) return draft;
      const fields = [...draft.fields];
      const [moved] = fields.splice(from, 1);
      if (!moved) return draft;
      fields.splice(index, 0, moved);
      return { ...draft, fields };
    });
    this.dragEnd();
  }

  dragEnd(): void {
    this.dragIndex.set(null);
    this.dragOverIndex.set(null);
  }

  moveField(index: number, delta: number): void {
    const target = index + delta;
    this.draft.update((draft) => {
      if (!draft || target < 0 || target >= draft.fields.length) return draft;
      const fields = [...draft.fields];
      const [moved] = fields.splice(index, 1);
      if (!moved) return draft;
      fields.splice(target, 0, moved);
      return { ...draft, fields };
    });
  }

  openFieldEditor(index: number): void {
    const field = this.draft()?.fields[index];
    if (!field || this.readOnly()) return;
    this.fieldEditIndex.set(index);
    this.fieldDraft.set({ ...field });
    this.fieldOptionsText.set((field.options ?? []).join(', '));
  }

  closeFieldEditor(): void {
    this.fieldEditIndex.set(null);
    this.fieldDraft.set(null);
    this.fieldOptionsText.set('');
  }

  setFieldDraft(key: keyof FieldDef, value: unknown): void {
    this.fieldDraft.update((field) => {
      if (!field) return field;
      const next: FieldDef = { ...field, [key]: value };
      if (key === 'type' && value === 'rows' && !next.cols?.length) {
        next.cols = [{ key: 'c1', label: 'รายการ', type: 'text' }];
      }
      if (key === 'type' && value === 'section') {
        next.required = false;
        next.hidden = false;
      }
      return next;
    });
  }

  saveFieldEditor(): void {
    const index = this.fieldEditIndex();
    const field = this.fieldDraft();
    const draft = this.draft();
    if (!field || !draft || this.readOnly()) return;
    if (!field.label.trim()) return this.toast.error('กรุณากรอกชื่อฟิลด์');
    if (!/^[a-zA-Z][A-Za-z0-9_]*$/.test(field.key)) return this.toast.error('key ต้องเป็นภาษาอังกฤษ/ตัวเลข/ขีดล่าง และขึ้นต้นด้วยตัวอักษร');
    if (draft.fields.some((item, i) => item.key === field.key && i !== index)) return this.toast.error('key นี้ถูกใช้แล้ว');
    if (field.required && field.hidden) return this.toast.error('ฟิลด์บังคับและซ่อนพร้อมกันไม่ได้');
    if ((field.type === 'select' || field.type === 'multiselect') && !this.fieldOptionsText().trim()) return this.toast.error('กรุณากรอกตัวเลือก');
    if (field.type === 'ref' && !field.ref) return this.toast.error('กรุณาเลือกโมดูลปลายทาง');
    const oldKey = index === null ? undefined : draft.fields[index]?.key;
    const nextField: FieldDef = {
      ...field,
      label: field.label.trim(),
      options: field.type === 'select' || field.type === 'multiselect'
        ? this.fieldOptionsText().split(',').map((item) => item.trim()).filter(Boolean)
        : undefined,
      wide: !!field.wide || undefined,
      unique: !!field.unique || undefined,
      readOnly: !!field.readOnly || undefined,
      hidden: !!field.hidden,
      required: !!field.required,
      help: field.help?.trim() || undefined,
      suffix: field.suffix?.trim() || undefined,
    };
    this.draft.update((current) => {
      if (!current) return current;
      if (index === null) {
        return { ...current, fields: [...current.fields, nextField] };
      }
      const fields = current.fields.map((item, i) => (i === index ? nextField : item));
      let title = current.title;
      let cols = current.cols;
      let filters = current.filters;
      if (oldKey && oldKey !== nextField.key) {
        title = title === oldKey ? nextField.key : title;
        cols = cols.map((key) => (key === oldKey ? nextField.key : key));
        filters = filters.map((key) => (key === oldKey ? nextField.key : key));
      }
      return { ...current, fields, title, cols, filters };
    });
    this.closeFieldEditor();
  }

  fieldTypeLabel(type: string): string {
    return this.fieldTypes.find(([key]) => key === type)?.[1] ?? type;
  }

  entityLabel(key?: string): string {
    if (!key) return '–';
    if (key === 'users') return 'ผู้ใช้';
    return this.entities().find((entity) => entity.key === key)?.label ?? key;
  }

  fieldSummary(field: FieldDef): string {
    if (field.type === 'select' || field.type === 'multiselect') return `${(field.options ?? []).length} ตัวเลือก`;
    if (field.type === 'ref') return `เชื่อม → ${this.entityLabel(field.ref)}`;
    if (field.type === 'rows') return `${(field.cols ?? []).length} คอลัมน์`;
    if (field.type === 'formula' && field.formula) return `สูตร: ${field.formula}`;
    return '';
  }

  openRename(index: number): void {
    const field = this.draft()?.fields[index];
    if (!field) return;
    this.renameIndex.set(index);
    this.renameValue.set(field.key);
    this.renameError.set('');
  }

  renameFromField(): void {
    const index = this.fieldEditIndex();
    if (index === null) return;
    this.closeFieldEditor();
    this.openRename(index);
  }

  closeRename(): void {
    if (this.renameBusy()) return;
    this.renameIndex.set(null);
    this.renameValue.set('');
    this.renameError.set('');
  }

  renameField(): void {
    const draft = this.draft();
    const field = this.renameTarget();
    const to = this.renameValue().trim();
    if (!draft || !field || !to || to === field.key || this.renameBusy()) return;
    this.renameBusy.set(true);
    this.renameError.set('');
    this.api.post<{ from: string; to: string; migrated: number }>(
      `/meta/entity/${draft.key}/rename-field`,
      { from: field.key, to },
    ).subscribe({
      next: (result) => {
        this.renameBusy.set(false);
        this.renameIndex.set(null);
        this.renameValue.set('');
        this.toast.show(`เปลี่ยน key ${result.from} → ${result.to} แล้ว (${result.migrated} รายการ)`);
        this.meta.clearOptions();
        this.meta.load(true);
        this.load();
      },
      error: (error: unknown) => {
        this.renameBusy.set(false);
        this.renameError.set(apiErrorMessage(error));
      },
    });
  }

  save(): void {
    const draft = this.draft();
    if (!draft || this.saving() || this.readOnly()) return;
    this.saving.set(true);
    this.draftMessage.set('');
    this.api.put<EntityDef>(`/meta/entity/${draft.key}`, this.modulePayload(draft)).subscribe({
      next: () => {
        this.saving.set(false);
        this.toast.show('บันทึกโครงสร้างโมดูลแล้ว');
        this.meta.clearOptions();
        this.meta.load(true);
        this.loadRoles();
        this.load();
      },
      error: (error: unknown) => {
        this.saving.set(false);
        this.draftMessage.set(apiErrorMessage(error));
      },
    });
  }

  /** `/meta/config` adds derived keys such as `workflowKey`; the DTO rejects unknown properties. */
  private modulePayload(draft: EntityDef, extra: Record<string, unknown> = {}): Record<string, unknown> {
    return {
      key: draft.key,
      label: draft.label,
      prefix: draft.prefix,
      title: draft.title,
      cols: draft.cols,
      filters: draft.filters,
      fields: draft.fields,
      scoped: draft.scoped,
      custom: draft.custom,
      group: draft.group,
      navLabel: draft.navLabel,
      icon: draft.icon,
      description: draft.description,
      aliases: draft.aliases,
      status: draft.status,
      ...(draft.custom && this.roles().length ? { roleIds: this.draftRoleIds() } : {}),
      ...extra,
    };
  }

  statusLabel(entity: EntityDef): string {
    const status = entity.status ?? 'published';
    return status === 'draft' ? 'ร่าง' : status === 'archived' ? 'เก็บถาวร' : 'เผยแพร่';
  }

  /** Lifecycle switches save the current structure with only `status` changed. */
  setModuleStatus(status: 'draft' | 'published' | 'archived'): void {
    const draft = this.draft();
    if (!draft?.custom || this.saving()) return;
    this.saving.set(true);
    this.draftMessage.set('');
    this.api.put<EntityDef>(`/meta/entity/${draft.key}`, this.modulePayload(draft, { status })).subscribe({
      next: () => {
        this.saving.set(false);
        this.toast.show(`ตั้งสถานะโมดูลเป็น “${status === 'draft' ? 'ร่าง' : status === 'archived' ? 'เก็บถาวร' : 'เผยแพร่'}” แล้ว`);
        this.meta.clearOptions();
        this.meta.load(true);
        this.load();
      },
      error: (error: unknown) => {
        this.saving.set(false);
        this.draftMessage.set(apiErrorMessage(error));
      },
    });
  }

  removeModule(): void {
    const draft = this.draft();
    if (!draft?.custom) return;
    if (!confirm(`ลบโมดูล “${draft.label}”? ข้อมูลต้องว่างก่อน`)) return;
    this.api.delete(`/meta/entity/${draft.key}`).subscribe({
      next: () => {
        this.toast.show('ลบโมดูลแล้ว');
        this.meta.load(true);
        this.load();
      },
      error: (error: unknown) => this.toast.error(apiErrorMessage(error)),
    });
  }

  openCreate(): void {
    this.newTemplate.set('blank');
    this.newStatus.set('draft');
    this.newFieldsOverride.set(null);
    this.newModule.set({ label: '', key: '', prefix: 'DOC', group: '', navLabel: '', icon: 'puzzle', description: '' });
    this.newRoleIds.set([]);
    this.newError.set('');
    this.newOpen.set(true);
  }

  setNew(key: 'label' | 'key' | 'prefix' | 'group' | 'navLabel' | 'icon' | 'description', value: string): void {
    this.newModule.update((module) => ({ ...module, [key]: value }));
  }

  applyTemplate(key: string): void {
    this.newTemplate.set(key);
    this.newFieldsOverride.set(null);
    const template = this.moduleTemplates.find((item) => item.key === key);
    if (!template) return;
    this.newModule.update((module) => ({
      ...module,
      label: template.label,
      prefix: template.prefix,
      group: template.group,
      navLabel: template.label,
      icon: template.icon,
      description: template.description,
    }));
  }

  duplicateModule(): void {
    const draft = this.draft();
    if (!draft?.custom) return;
    this.newTemplate.set('duplicate');
    this.newFieldsOverride.set(JSON.parse(JSON.stringify(draft.fields)) as FieldDef[]);
    this.newModule.set({
      label: `${draft.label} (สำเนา)`,
      key: '',
      prefix: draft.prefix,
      group: draft.group ?? '',
      navLabel: draft.navLabel ?? '',
      icon: draft.icon || 'puzzle',
      description: draft.description ?? '',
    });
    this.newRoleIds.set([...this.draftRoleIds()]);
    this.newError.set('');
    this.newOpen.set(true);
  }

  async importSchema(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    try {
      const data = JSON.parse(await file.text()) as Partial<EntityDef>;
      if (!data || !Array.isArray(data.fields) || !data.fields.length) throw new Error('invalid');
      this.newTemplate.set('import');
      this.newFieldsOverride.set(data.fields as FieldDef[]);
      this.newModule.set({
        label: String(data.label ?? 'โมดูลนำเข้า'),
        key: String(data.key ?? ''),
        prefix: String(data.prefix ?? 'DOC'),
        group: String(data.group ?? ''),
        navLabel: String(data.navLabel ?? ''),
        icon: String(data.icon ?? 'puzzle'),
        description: String(data.description ?? ''),
      });
      this.newRoleIds.set([...this.draftRoleIds()]);
      this.newError.set('');
      this.newOpen.set(true);
    } catch {
      this.toast.error('ไฟล์ JSON ของโมดูลไม่ถูกต้อง');
    } finally {
      input.value = '';
    }
  }

  exportModule(): void {
    const draft = this.draft();
    if (!draft?.custom) return;
    const blob = new Blob([JSON.stringify(draft, null, 2)], { type: 'application/json' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `${draft.key}-module.json`;
    link.click();
    URL.revokeObjectURL(link.href);
  }

  toggleRole(id: string, checked: boolean): void {
    this.newRoleIds.update((ids) => (checked ? [...ids, id] : ids.filter((roleId) => roleId !== id)));
  }

  createModule(): void {
    const module = this.newModule();
    if (!module.label.trim() || !module.key.trim()) return this.toast.error('กรอกชื่อและ key ของโมดูล');
    this.newBusy.set(true);
    this.newError.set('');
    const template = this.moduleTemplates.find((item) => item.key === this.newTemplate()) ?? this.moduleTemplates[0];
    const fields = (this.newFieldsOverride() ?? template.fields).map((field) => ({ ...field }));
    const title = fields.find((field) => field.type === 'text')?.key ?? fields[0]?.key ?? 'name';
    const extraCols = fields
      .filter((field) => ['select', 'date', 'number'].includes(field.type))
      .map((field) => field.key)
      .slice(0, 2);
    const body: EntityDef & { roleIds?: string[] } = {
      key: module.key.trim(),
      label: module.label.trim(),
      prefix: module.prefix || 'DOC',
      resource: module.key.trim(),
      title,
      cols: ['code', title, ...extraCols.filter((key) => key !== title)],
      filters: [],
      fields,
      custom: true,
      scoped: false,
      group: module.group,
      navLabel: module.navLabel,
      icon: module.icon,
      description: module.description,
      status: this.newStatus(),
      ...(this.roles().length ? { roleIds: this.newRoleIds() } : {}),
    };
    this.api.post<EntityDef>('/meta/entities', body).subscribe({
      next: (entity) => {
        this.newBusy.set(false);
        this.newOpen.set(false);
        this.newFieldsOverride.set(null);
        this.selectedKey.set(entity.key);
        this.meta.clearOptions();
        this.meta.load(true);
        this.loadRoles();
        this.load();
        this.toast.show('สร้างโมดูลแล้ว');
      },
      error: (error: unknown) => {
        this.newBusy.set(false);
        this.newError.set(apiErrorMessage(error));
      },
    });
  }

  saveLists(): void {
    this.api.put('/meta/lists', {
      teams: this.teams().split('\n').map((s) => s.trim()).filter(Boolean),
      depts: this.depts().split('\n').map((s) => s.trim()).filter(Boolean),
    }).subscribe({
      next: () => {
        this.meta.load(true);
        this.toast.show('บันทึกทีม/แผนกแล้ว');
      },
      error: (error: unknown) => this.toast.error(apiErrorMessage(error)),
    });
  }
}
