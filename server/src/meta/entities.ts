import { NotFoundException } from '@nestjs/common';

export type FieldType =
  | 'text'
  | 'textarea'
  | 'number'
  | 'date'
  | 'datetime'
  | 'select'
  | 'multiselect'
  | 'boolean'
  | 'ref'
  | 'file'
  | 'rows'
  | 'formula'
  | 'section'
  | 'email'
  | 'phone'
  | 'url';

export interface RowColumn {
  key: string;
  label: string;
  type: FieldType;
  ref?: string;
  options?: string[];
  required?: boolean;
}

export type OptionColor = 'gray' | 'red' | 'amber' | 'green' | 'blue';

/** Stable option metadata: the id is stored in records, label/color are display only. */
export interface OptionDef {
  id: string;
  label: string;
  color?: OptionColor;
  archived?: boolean;
  /** Role ids allowed to pick this option; empty/undefined means every role. */
  roles?: string[];
}

export interface FieldDef {
  key: string;
  label: string;
  type: FieldType;
  required?: boolean;
  unique?: boolean;
  options?: string[];
  optionMeta?: OptionDef[];
  optionsFrom?: 'teams' | 'depts';
  ref?: string;
  /** Ref fields can hold several record ids (array) instead of one. */
  multiple?: boolean;
  /** Field on the target dataset used as the readable label in pickers and grids. */
  displayField?: string;
  cols?: RowColumn[];
  hidden?: boolean;
  showIf?: { field: string; value: unknown };
  suffix?: string;
  /** Number/money: allowed decimal places, range, and ISO 4217 currency code (display/unit only; never summed across currencies). */
  decimals?: number;
  min?: number;
  max?: number;
  currency?: string;
  /** Text: maximum length. */
  maxLength?: number;
  help?: string;
  wide?: boolean;
  readOnly?: boolean;
  sensitive?: boolean;
  formula?: string;
  /** Hidden from forms/filters but keeps existing values (no data loss). */
  archived?: boolean;
  /** Reverse side of a relation: kept in sync from `entity`.`field`. */
  mirror?: { entity: string; field: string };
  /** Ref picker: only offer target records whose `targetField` equals this record's `by` value. */
  optionFilter?: { by: string; targetField: string };
}

export interface FieldDefInput {
  key?: string;
  label?: string;
  type?: string;
  required?: boolean;
  hidden?: boolean;
  readOnly?: boolean;
  sensitive?: boolean;
  wide?: boolean;
  help?: string;
  suffix?: string;
  decimals?: number;
  min?: number;
  max?: number;
  currency?: string;
  maxLength?: number;
  ref?: string;
  multiple?: boolean;
  displayField?: string;
  optionMeta?: { id?: string; label?: string; color?: string; archived?: boolean; roles?: string[] }[];
  formula?: string;
  options?: string[];
  optionsFrom?: 'teams' | 'depts';
  archived?: boolean;
  mirror?: { entity?: string; field?: string };
  optionFilter?: { by?: string; targetField?: string };
  cols?: { key?: string; label?: string; type?: string; ref?: string; options?: string[]; required?: boolean }[];
  showIf?: { field?: string; value?: unknown };
}

/** Client payload for a dataset; `fields` and `cols` are validated before use. */
/** Draft and archived modules are hidden from operations: no meta, no direct link, no records. */
export function isOperational(def: EntityDef): boolean {
  if (!def.custom) return true;
  return (def.status ?? 'published') === 'published';
}

export interface EntityInput extends Partial<Omit<EntityDef, 'key' | 'label' | 'fields' | 'cols' | 'filters'>> {
  key: string;
  label: string;
  fields?: FieldDefInput[];
  cols?: string[];
  filters?: string[];
}

export interface EntityDef {
  key: string;
  label: string;
  resource: string;
  prefix: string;
  title: string;
  cols: string[];
  filters: string[];
  fields: FieldDef[];
  scoped?: boolean;
  system?: boolean;
  custom?: boolean;
  /** Lifecycle for custom modules; system modules are always operational. */
  status?: 'draft' | 'published' | 'archived';
  /** Navigation group for custom modules, e.g. "งานบริการและโครงการ". */
  group?: string;
  /** Short label used by the sidebar; falls back to `label`. */
  navLabel?: string;
  /** Icon key used by the dynamic sidebar. */
  icon?: string;
  /** Short description shown in the module builder. */
  description?: string;
  /** Admin-editable search terms (nicknames, English/Thai variants). */
  aliases?: string[];
}

export interface WorkflowStatus {
  key: string;
  label: string;
  color: string;
  next: string[];
  requiredFields: string[];
  final?: boolean;
  needClosePerm?: boolean;
  enabled: boolean;
  approverRole?: string;
  approverUser?: string;
}

export interface StepDoc {
  key: string;
  label: string;
  /** Must be attached before the step can close. */
  required?: boolean;
  /** Must record signer name + signed date on at least one attachment. */
  signoff?: boolean;
}

export interface ProjectStepDef {
  key: string;
  label: string;
  desc: string;
  fields: FieldDef[];
  docs: StepDoc[];
  enabled: boolean;
  requireDocs: boolean;
  approvalRequired: boolean;
  approverRole?: string;
  approverUser?: string;
  source?: string;
  /** When set, the step only appears for these project tracks (e.g. R&D). */
  tracks?: string[];
}

const f = (key: string, label: string, type: FieldType = 'text', extra: Partial<FieldDef> = {}): FieldDef => ({
  key,
  label,
  type,
  ...extra,
});

const TEAM: Partial<FieldDef> = { optionsFrom: 'teams' };

const ticketStatuses = (): WorkflowStatus[] => [
  { key: 'received', label: 'รับเรื่อง', color: 'blue', next: ['triage'], requiredFields: [], enabled: true },
  {
    key: 'triage',
    label: 'คัดแยก/ตรวจสอบเบื้องต้น',
    color: 'blue',
    next: ['remote', 'wait_info', 'wait_parts', 'wait_ext', 'wait_appt', 'appt', 'inprogress', 'verify'],
    requiredFields: [],
    enabled: true,
  },
  {
    key: 'remote',
    label: 'กำลังแก้ไขระยะไกล',
    color: 'indigo',
    next: ['triage', 'wait_info', 'wait_parts', 'wait_ext', 'wait_appt', 'appt', 'verify'],
    requiredFields: [],
    enabled: true,
  },
  {
    key: 'wait_info',
    label: 'รอข้อมูล',
    color: 'amber',
    next: ['triage', 'remote', 'appt', 'inprogress', 'verify'],
    requiredFields: [],
    enabled: true,
  },
  {
    key: 'wait_parts',
    label: 'รออะไหล่',
    color: 'amber',
    next: ['triage', 'remote', 'appt', 'inprogress', 'verify'],
    requiredFields: [],
    enabled: true,
  },
  {
    key: 'wait_ext',
    label: 'รอทีมภายนอก',
    color: 'amber',
    next: ['triage', 'remote', 'appt', 'inprogress', 'verify'],
    requiredFields: [],
    enabled: true,
  },
  {
    key: 'wait_appt',
    label: 'รอนัดหมายช่าง',
    color: 'amber',
    next: ['triage', 'appt', 'inprogress'],
    requiredFields: [],
    enabled: true,
  },
  {
    key: 'appt',
    label: 'นัดหมายเข้าหน้างาน',
    color: 'violet',
    next: ['inprogress', 'wait_info', 'wait_parts', 'wait_ext', 'wait_appt'],
    requiredFields: [],
    enabled: true,
  },
  {
    key: 'inprogress',
    label: 'กำลังดำเนินการ',
    color: 'indigo',
    next: ['wait_parts', 'wait_ext', 'appt', 'verify'],
    requiredFields: [],
    enabled: true,
  },
  {
    key: 'verify',
    label: 'รอตรวจสอบผล',
    color: 'teal',
    next: ['inprogress', 'informed'],
    requiredFields: ['resolution'],
    enabled: true,
  },
  {
    key: 'informed',
    label: 'แจ้งผลผู้ใช้',
    color: 'teal',
    next: ['closed', 'inprogress'],
    requiredFields: ['resolution'],
    enabled: true,
  },
  {
    key: 'closed',
    label: 'ปิดเคส',
    color: 'green',
    next: ['triage'],
    requiredFields: ['cause', 'resolution'],
    final: true,
    needClosePerm: true,
    enabled: true,
  },
];

const poStatuses = (): WorkflowStatus[] => [
  { key: 'draft', label: 'ร่าง', color: 'gray', next: ['ordered', 'cancelled'], requiredFields: [], enabled: true },
  { key: 'ordered', label: 'สั่งซื้อแล้ว', color: 'blue', next: ['partial', 'received', 'cancelled'], requiredFields: [], enabled: true },
  { key: 'partial', label: 'รับบางส่วน', color: 'amber', next: ['received', 'cancelled'], requiredFields: [], enabled: true },
  { key: 'received', label: 'รับครบ', color: 'teal', next: ['closed'], requiredFields: [], enabled: true },
  { key: 'closed', label: 'ปิด', color: 'green', next: [], requiredFields: [], final: true, needClosePerm: true, enabled: true },
  { key: 'cancelled', label: 'ยกเลิก', color: 'red', next: [], requiredFields: [], final: true, enabled: true },
];

const D = (key: string, label: string, extra: Partial<StepDoc> = {}): StepDoc => ({ key, label, ...extra });
const S = (
  key: string,
  label: string,
  desc: string,
  fields: FieldDef[] = [],
  docs: StepDoc[] = [],
  extra: Partial<ProjectStepDef> = {},
): ProjectStepDef => ({
  key,
  label,
  desc,
  fields,
  docs,
  enabled: true,
  requireDocs: false,
  approvalRequired: false,
  source: 'document',
  ...extra,
});
const sel = (key: string, label: string, options: string[], extra: Partial<FieldDef> = {}): FieldDef =>
  f(key, label, 'select', { options, ...extra });

const invoiceStatuses = (): WorkflowStatus[] => [
  { key: 'draft', label: 'ร่าง', color: 'gray', next: ['sent', 'cancelled'], requiredFields: [], enabled: true },
  { key: 'sent', label: 'ส่งแล้ว', color: 'blue', next: ['paid', 'cancelled'], requiredFields: [], enabled: true },
  { key: 'paid', label: 'ชำระแล้ว', color: 'green', next: [], requiredFields: [], enabled: true, final: true },
  { key: 'cancelled', label: 'ยกเลิก', color: 'red', next: [], requiredFields: [], enabled: true, final: true },
];

const expenseStatuses = (): WorkflowStatus[] => [
  { key: 'draft', label: 'ร่าง', color: 'gray', next: ['submitted', 'cancelled'], requiredFields: [], enabled: true },
  { key: 'submitted', label: 'รออนุมัติ', color: 'amber', next: ['approved', 'cancelled'], requiredFields: [], enabled: true },
  { key: 'approved', label: 'อนุมัติแล้ว', color: 'blue', next: ['paid', 'cancelled'], requiredFields: [], enabled: true },
  { key: 'paid', label: 'จ่ายแล้ว', color: 'green', next: [], requiredFields: [], enabled: true, final: true },
  { key: 'cancelled', label: 'ยกเลิก', color: 'red', next: [], requiredFields: [], enabled: true, final: true },
];

export const projectSteps = (): ProjectStepDef[] => [
  S(
    'req',
    '1. รับ Requirement จากลูกค้า',
    'เก็บช่องทางรับเรื่อง ผู้ติดต่อ รายละเอียดความต้องการ เอกสารแนบ และผู้รับผิดชอบ',
    [
      sel('channel', 'ช่องทางรับเรื่อง', ['โทรศัพท์', 'LINE', 'อีเมล', 'หนังสือราชการ', 'พบลูกค้า', 'อื่นๆ']),
      f('contact', 'ผู้ติดต่อ', 'ref', { ref: 'contacts' }),
      f('requirement', 'รายละเอียดความต้องการ', 'textarea', { required: true }),
    ],
    [D('req_files', 'เอกสารแนบจากลูกค้า')],
  ),
  S(
    'assess',
    '2. ประเมินประเภทและขอบเขตโครงการ',
    'รองรับโครงการขนาดใหญ่ งานใช้อุปกรณ์พิเศษ และงานประเภทอื่น',
    [
      sel('kind', 'ประเภทงาน', ['โครงการขนาดใหญ่', 'งานใช้อุปกรณ์พิเศษ', 'ติดตั้งทั่วไป', 'อื่นๆ']),
      f('scope', 'สรุปขอบเขตงาน', 'textarea', { required: true }),
    ],
  ),
  S(
    'proposal',
    '3. จัดทำเอกสารเสนอและประเมินงาน',
    'Requirement Form/Card, BOQ, ใบเสนอราคา, TOR และเอกสารประกวดราคา/ประมูลตามที่ใช้จริง',
    [f('submitDate', 'วันที่ยื่นเอกสาร', 'date'), f('quoteNo', 'เลขที่ใบเสนอราคา'),
      sel('ictDefend', 'ผล defended ICT', ['ไม่ต้อง', 'รอผล', 'ผ่าน', 'ไม่ผ่าน'], { help: 'บังคับเมื่อเป็นโครงการราชการและมูลค่าเกินเกณฑ์ที่ตั้งไว้' })],
    [D('req_form', 'Requirement Form / Requirement Card'), D('boq', 'BOQ', { required: true }), D('quote', 'ใบเสนอราคา', { required: true }), D('tor', 'TOR'), D('bid_docs', 'เอกสารประกวดราคา/ประมูล (ถ้ามี)')],
  ),
  S(
    'bid',
    '4. บันทึกผลการเสนอราคา/ประมูล',
    'บันทึกชนะ/ไม่ชนะ เหตุผล และเอกสารอ้างอิง',
    [
      sel('bidResult', 'ผลการเสนอราคา/ประมูล', ['รอผล', 'ชนะ', 'ไม่ชนะ'], { required: true }),
      f('bidNo', 'เลขที่เอกสารประมูล'),
      f('bidPrice', 'ราคาที่เสนอ (บาท)', 'number'),
      f('bidReason', 'เหตุผล', 'textarea'),
      f('bidRef', 'เลขที่เอกสารอ้างอิง'),
    ],
    [D('bid_result', 'เอกสารผลการพิจารณา', { required: true })],
  ),
  S(
    'kickoff',
    '5. เริ่มโครงการ (สัญญา/PO/Kickoff)',
    'บันทึกสัญญา PO ผู้เกี่ยวข้อง และ Project Kickoff',
    [
      f('contractNo', 'เลขที่สัญญา'),
      f('poNo', 'เลขที่ PO'),
      sel('partner', 'คู่สัญญา/พาร์ตเนอร์', ['SJP', 'NT', 'อื่นๆ'], { help: 'ถ้าเป็น NT ต้องระบุเลขที่ MOU SJP–NT' }),
      f('mouNo', 'เลขที่ MOU SJP–NT'),
      f('signDate', 'วันที่ลงนามสัญญา', 'date'),
      f('kickoffDate', 'วันประชุม Kickoff', 'date'),
      f('stakeholders', 'ผู้เกี่ยวข้อง', 'textarea'),
    ],
    [D('contract', 'สัญญา', { required: true, signoff: true }), D('po', 'PO'), D('kickoff_minutes', 'บันทึกการประชุม Kickoff')],
  ),
  S(
    'survey',
    '6. สำรวจไซต์งาน',
    'บันทึกผู้เข้าร่วม และเก็บ Site Survey, Shop Drawing, แปลน, ตำแหน่งติดตั้ง และข้อกำหนดหน้างาน',
    [
      f('surveyDate', 'วันที่สำรวจ', 'date'),
      f('attendees', 'ผู้เข้าร่วมสำรวจ', 'rows', {
        cols: [
          { key: 'name', label: 'ชื่อ', type: 'text' },
          { key: 'party', label: 'สังกัด', type: 'select', options: ['ลูกค้า', 'ผู้ให้บริการเครือข่าย', 'SJP', 'ผู้รับเหมาช่วง', 'อื่นๆ'] },
        ],
      }),
      f('siteReq', 'ข้อกำหนดหน้างาน', 'textarea'),
    ],
    [D('survey', 'Site Survey', { required: true }), D('shop', 'Shop Drawing'), D('plan', 'แปลน'), D('positions', 'ตำแหน่งติดตั้ง')],
  ),
  S(
    'design',
    '7. ออกแบบและวางแผน',
    'เก็บ System Diagram, Network Diagram, Project Plan และ Schedule',
    [f('planStart', 'กำหนดเริ่มติดตั้ง', 'date'), f('planEnd', 'กำหนดแล้วเสร็จ', 'date')],
    [D('sys_diag', 'System Diagram'), D('net_diag', 'Network Diagram'), D('proj_plan', 'Project Plan'), D('schedule', 'Schedule')],
  ),
  S(
    'procure',
    '8. จัดซื้อ/นำเข้าและเตรียมอุปกรณ์',
    'บันทึกรายการที่ต้องใช้ ผู้ขาย สถานะสั่งซื้อ กำหนดส่ง และการตรวจรับ (ดู BOQ เทียบ PO ด้านล่าง)',
    [f('procNote', 'หมายเหตุการจัดซื้อ', 'textarea')],
  ),
  S(
    'preconfig',
    '9. Pre-Configuration',
    'บันทึกการตั้งค่าและตรวจความพร้อมของอุปกรณ์ก่อนส่งไปไซต์',
    [
      f('cfgDate', 'วันที่ตั้งค่า', 'date'),
      f('cfgRows', 'ผลตรวจความพร้อมอุปกรณ์', 'rows', {
        cols: [
          { key: 'device', label: 'อุปกรณ์/Serial', type: 'text' },
          { key: 'result', label: 'ผล', type: 'select', options: ['พร้อม', 'ไม่พร้อม'] },
          { key: 'note', label: 'หมายเหตุ', type: 'text' },
        ],
      }),
    ],
    [D('cfg_sheet', 'ใบบันทึกการตั้งค่า')],
  ),
  S(
    'dispatch',
    '10. เบิกและส่งอุปกรณ์ไปหน้างาน',
    'เก็บรายการ จำนวน รุ่น Serial ผู้รับ และหลักฐานส่งมอบ (เบิกผ่านหน้าคลังสินค้า)',
    [f('receiver', 'ผู้รับของ'), f('deliveryDate', 'วันที่ส่งมอบ', 'date')],
    [D('delivery_proof', 'หลักฐานการส่งมอบ')],
  ),
  S(
    'install',
    '11. ติดตั้งและทดสอบ',
    'บันทึกความก้าวหน้า ผลทดสอบ ปัญหา วิธีแก้ และผู้ปฏิบัติงาน',
    [
      f('progress', 'ความก้าวหน้า (%)', 'number'),
      sel('testResult', 'ผลการทดสอบ', ['ผ่าน', 'ผ่านแบบมีเงื่อนไข', 'ไม่ผ่าน']),
      f('issues', 'ปัญหาที่พบ', 'textarea'),
      f('fixes', 'วิธีแก้ไข', 'textarea'),
      f('workers', 'ผู้ปฏิบัติงาน'),
    ],
    [D('test_report', 'รายงานผลทดสอบ')],
  ),
  S(
    'handover',
    '12. ส่งมอบและตรวจรับ',
    'รายงานติดตั้งจริง, รายการอุปกรณ์/Serial, As-built, พิกัด/ภาพถ่าย, คู่มือ, เอกสารฝึกอบรม, เอกสารส่งมอบ/ผลตรวจรับ',
    [
      f('handoverDate', 'วันที่ส่งมอบ', 'date'),
      sel('acceptResult', 'ผลตรวจรับ', ['รอตรวจรับ', 'ผ่าน', 'ผ่านแบบมีเงื่อนไข', 'ไม่ผ่าน']),
      f('trainees', 'รายชื่อผู้เข้าอบรม', 'rows', {
        cols: [
          { key: 'name', label: 'ชื่อ', type: 'text' },
          { key: 'org', label: 'หน่วยงาน', type: 'text' },
        ],
      }),
    ],
    [
      D('install_report', 'รายงานติดตั้งจริง', { required: true }),
      D('asbuilt', 'As-built Drawing'),
      D('asbuilt_net', 'Network Diagram (As-built)'),
      D('photos', 'จุดพิกัดและภาพถ่ายหน้างาน'),
      D('manual', 'คู่มือระบบ'),
      D('training', 'เอกสารฝึกอบรม'),
      D('handover_doc', 'เอกสารส่งมอบ', { required: true, signoff: true }),
      D('acceptance', 'ผลตรวจรับตามข้อกำหนดโครงการ', { required: true, signoff: true }),
    ],
  ),
  S(
    'after',
    '13. บริการหลังส่งมอบ',
    'บันทึกสัญญาบริการ งาน PM/CM และรายงานประจำเดือน ถ้าอยู่ในขอบเขตสัญญา',
    [
      f('svcContract', 'เลขที่สัญญาบริการ'),
      f('svcStart', 'เริ่มสัญญาบริการ', 'date'),
      f('svcEnd', 'สิ้นสุดสัญญาบริการ', 'date'),
      f('includePM', 'รวมงาน PM', 'boolean'),
      f('monthlyReport', 'ต้องมีรายงานประจำเดือน', 'boolean'),
    ],
    [D('svc_contract', 'สัญญาบริการ')],
  ),
  S(
    'removal',
    '14. ถอด/เลิกติดตั้ง (เมื่อเลิกสัญญา)',
    'ใช้เมื่อสิ้นสุดสัญญาหรือลูกค้ายกเลิก — บันทึกการถอดอุปกรณ์ การคืนของ และปิดโครงการ (ข้ามได้ถ้ายังใช้งานต่อ)',
    [
      f('removalDate', 'วันที่ถอด/เลิกติดตั้ง', 'date'),
      sel('removalReason', 'เหตุผล', ['สิ้นสุดสัญญา', 'ลูกค้ายกเลิก', 'ย้ายสถานที่', 'อื่นๆ']),
      f('removalNote', 'รายละเอียดการถอด/คืนอุปกรณ์', 'textarea'),
    ],
    [
      D('removal_report', 'รายงานการถอดอุปกรณ์', { required: true }),
      D('equipment_return', 'เอกสารคืนอุปกรณ์/หลักฐาน', { signoff: true }),
    ],
  ),
  // ---------- R&D track (only shown when project.track = R&D) ----------
  S(
    'rnd_req',
    '1. Requirement Card & Stakeholder',
    'เก็บโจทย์ ปัญหา และผู้มีส่วนได้ส่วนเสียก่อนเริ่มพัฒนาผลิตภัณฑ์',
    [
      sel('rndSource', 'แหล่งที่มา', ['ลูกค้า', 'ภายใน', 'พาร์ตเนอร์']),
      f('stakeholder', 'Stakeholder หลัก'),
      f('problem', 'ปัญหาที่ต้องการแก้', 'textarea', { required: true }),
      f('goal', 'เป้าหมาย/ผลลัพธ์', 'textarea'),
    ],
    [D('req_card', 'Requirement Card', { required: true }), D('stakeholder_note', 'Stakeholder Note')],
    { tracks: ['R&D'] },
  ),
  S(
    'rnd_design',
    '2. แนวคิด/ทางเลือกการออกแบบ',
    'Project Sketch, ทางเลือก และเหตุผลที่เลือก',
    [f('options', 'ทางเลือกที่พิจารณา', 'textarea'), f('chosen', 'แนวทางที่เลือก')],
    [D('sketch', 'Project Sketch Sheet'), D('options_doc', 'เอกสารทางเลือก')],
    { tracks: ['R&D'] },
  ),
  S(
    'rnd_proto',
    '3. Prototype Design & Test',
    'ออกแบบต้นแบบ ทดสอบ และบันทึกผล',
    [f('protoScope', 'ขอบเขต Prototype'), f('protoResult', 'ผลทดสอบ', 'textarea')],
    [D('proto_log', 'Prototype Design (Log)', { required: true }), D('test_summary', 'Test Summary Sheet')],
    { tracks: ['R&D'] },
  ),
  S(
    'rnd_poc',
    '4. POC & Risk',
    'ผล POC ข้อจำกัด และความเสี่ยงก่อนผลิตจริง',
    [sel('pocResult', 'ผล POC', ['ผ่าน', 'ผ่านแบบมีเงื่อนไข', 'ไม่ผ่าน']), f('riskNote', 'ความเสี่ยง/แนวทางลด', 'textarea')],
    [D('poc_result', 'POC Result Form', { required: true }), D('risk_note', 'Risk Note')],
    { tracks: ['R&D'] },
  ),
  S(
    'rnd_diagram',
    '5. Block/Network Diagram & Flowchart',
    'ผังระบบ เครือข่าย และลำดับการทำงานของซอฟต์แวร์',
    [],
    [D('block_diagram', 'Block Diagram'), D('network_diagram', 'Network Diagram'), D('flowchart', 'Functional Flowchart')],
    { tracks: ['R&D'] },
  ),
  S(
    'rnd_docs',
    '6. เอกสารสินค้า (BOM/Datasheet/Assembly/QC)',
    'ชุดเอกสารพร้อมผลิตและขาย',
    [],
    [
      D('bom', 'Bill of Material (BOM)'),
      D('datasheet', 'Final Spec Sheet (Datasheet)', { required: true }),
      D('assembly', 'Assembly Guide'),
      D('qc_checklist', 'QC Checklist'),
      D('testing_standard', 'Testing Standard'),
    ],
    { tracks: ['R&D'] },
  ),
  S(
    'rnd_slide',
    '7. Product Slide / Sales Pack',
    'สื่อนำเสนอผลิตภัณฑ์สำหรับขาย/พาร์ตเนอร์',
    [],
    [D('product_slide', 'Product Slide')],
    { tracks: ['R&D'] },
  ),
  S(
    'rnd_signoff',
    '8. Sign-off (ลูกค้า/พาร์ตเนอร์)',
    'ยืนยันผลลัพธ์ก่อนส่งเข้า production/ขาย',
    [f('signDate', 'วันที่ลงนาม', 'date'), f('signer', 'ผู้ลงนาม/หน่วยงาน')],
    [D('signoff_doc', 'เอกสาร Sign-off', { required: true, signoff: true })],
    { tracks: ['R&D'] },
  ),
];

/** Steps that apply to a project track; R&D uses its own pipeline. */
export const projectStepsFor = (track?: string): ProjectStepDef[] => {
  const value = String(track ?? '').trim() || 'มาตรฐาน';
  return projectSteps().filter((step) =>
    step.enabled && (value === 'R&D' ? step.tracks?.includes('R&D') : !step.tracks),
  );
};

export const LISTS = {
  teams: ['ทีมโครงการ', 'ทีมบริการ/ซ่อมบำรุง', 'ทีมเครือข่าย', 'ศูนย์รับแจ้ง', 'ทีมคลัง/พัสดุ'],
  depts: ['โครงการ', 'บริการหลังการขาย', 'จัดซื้อ/คลัง', 'บริหาร'],
};

export const WORKFLOWS = {
  ticket: { confirmed: false, statuses: ticketStatuses() },
  po: { confirmed: false, statuses: poStatuses(), limits: [] as { upTo: number | string; approverRole?: string; approverUser?: string }[] },
  project: { confirmed: false, steps: projectSteps() },
  invoice: { confirmed: false, statuses: invoiceStatuses() },
  expense: { confirmed: false, statuses: expenseStatuses() },
};

// Workflow keys are short aliases while record entities use plural keys.
// Keep the mapping in one place so metadata editing, generic transitions and
// the UI always agree on which workflow belongs to which entity.
export const ENTITY_WORKFLOW_KEY: Record<string, string> = {
  tickets: 'ticket',
  purchaseOrders: 'po',
  projects: 'project',
  invoices: 'invoice',
  expenses: 'expense',
};
export const WORKFLOW_ENTITY_KEY: Record<string, string> = {
  ticket: 'tickets',
  po: 'purchaseOrders',
  project: 'projects',
  invoice: 'invoices',
  expense: 'expenses',
};

export const RESOURCE_LABELS: Record<string, string> = {
  master: 'ลูกค้า/ผู้ขาย/ผู้ติดต่อ/ไซต์',
  assets: 'สินค้า/อุปกรณ์/Serial',
  projects: 'โครงการ',
  tickets: 'Service Ticket',
  purchase: 'จัดซื้อ',
  warehouse: 'คลังสินค้า',
  accounting: 'บัญชี/การเงิน',
  pm: 'งาน PM',
  reports: 'รายงาน',
  settings: 'ตั้งค่าระบบ',
  users: 'ผู้ใช้',
  roles: 'บทบาท/สิทธิ์',
  vehicles: 'รถบริษัท',
  vehicleBookings: 'จองรถ',
};

export const ENTITY_DEFS: Record<string, EntityDef> = {
  customers: {
    key: 'customers',
    label: 'ลูกค้า',
    resource: 'master',
    prefix: 'CUS',
    title: 'name',
    cols: ['code', 'name', 'type', 'phone', 'owner'],
    filters: ['type'],
    fields: [
      f('name', 'ชื่อลูกค้า', 'text', { required: true }),
      f('taxId', 'เลขประจำตัวผู้เสียภาษี', 'text', { help: 'ใช้บนใบกำกับภาษี/ใบแจ้งหนี้ (13 หลัก)' }),
      f('type', 'ประเภท', 'select', { options: ['ภาครัฐ', 'รัฐวิสาหกิจ', 'เอกชน', 'อื่นๆ'] }),
      f('phone', 'โทรศัพท์'),
      f('email', 'อีเมล', 'email'),
      f('address', 'ที่อยู่', 'textarea'),
      f('owner', 'ผู้รับผิดชอบบัญชี', 'ref', { ref: 'users', help: 'ผู้ดูแลความสัมพันธ์หลักของลูกค้ารายนี้' }),
      f('note', 'หมายเหตุ', 'textarea'),
      f('attachments', 'ไฟล์แนบ', 'file', { help: 'สัญญา ใบเสนอราคา หรือเอกสารยืนยันตัวตน' }),
    ],
  },
  vendors: {
    key: 'vendors',
    label: 'ผู้ขาย',
    resource: 'master',
    prefix: 'VEN',
    title: 'name',
    cols: ['code', 'name', 'category', 'phone', 'email'],
    filters: ['category'],
    fields: [
      f('name', 'ชื่อผู้ขาย', 'text', { required: true }),
      f('taxId', 'เลขประจำตัวผู้เสียภาษี'),
      f('category', 'หมวดสินค้า/บริการ', 'select', { options: ['อุปกรณ์ CCTV', 'อุปกรณ์เครือข่าย/Fiber', 'จอ LED', 'เสียงประกาศ (PA)', 'เซนเซอร์/ตรวจวัด', 'โดรน', 'ผู้รับเหมาช่วง', 'อื่นๆ'] }),
      f('phone', 'โทรศัพท์'),
      f('email', 'อีเมล', 'email'),
      f('address', 'ที่อยู่', 'textarea'),
      f('paymentTerms', 'เงื่อนไขการชำระเงิน'),
      f('note', 'หมายเหตุ', 'textarea'),
      f('attachments', 'ไฟล์แนบ', 'file'),
    ],
  },
  contacts: {
    key: 'contacts',
    label: 'ผู้ติดต่อ',
    resource: 'master',
    prefix: 'CON',
    title: 'name',
    cols: ['name', 'position', 'customer', 'vendor', 'phone', 'email'],
    filters: [],
    fields: [
      f('name', 'ชื่อผู้ติดต่อ', 'text', { required: true }),
      f('position', 'ตำแหน่ง'),
      f('customer', 'ลูกค้า', 'ref', { ref: 'customers' }),
      f('vendor', 'ผู้ขาย', 'ref', { ref: 'vendors' }),
      f('phone', 'โทรศัพท์'),
      f('email', 'อีเมล', 'email'),
      f('line', 'LINE ID'),
      f('note', 'หมายเหตุ', 'textarea'),
    ],
  },
  sites: {
    key: 'sites',
    label: 'ไซต์งาน/สถานที่',
    resource: 'master',
    prefix: 'SITE',
    title: 'name',
    cols: ['code', 'name', 'customer', 'province', 'team'],
    filters: ['team', 'customer'],
    scoped: true,
    fields: [
      f('name', 'ชื่อไซต์/สถานที่', 'text', { required: true }),
      f('customer', 'ลูกค้า', 'ref', { ref: 'customers', required: true }),
      f('address', 'ที่อยู่', 'textarea'),
      f('province', 'จังหวัด/เขต'),
      f('lat', 'ละติจูด', 'number'),
      f('lng', 'ลองจิจูด', 'number'),
      f('contact', 'ผู้ติดต่อประจำไซต์', 'ref', { ref: 'contacts' }),
      f('team', 'ทีมดูแล', 'select', TEAM),
      f('note', 'หมายเหตุ', 'textarea'),
    ],
  },
  items: {
    key: 'items',
    label: 'สินค้า/อุปกรณ์/อะไหล่',
    resource: 'assets',
    prefix: 'ITM',
    title: 'name',
    cols: ['sku', 'name', 'category', 'kind', 'brand', 'model', 'trackSerial'],
    filters: ['category', 'kind'],
    fields: [
      f('name', 'ชื่อสินค้า/อุปกรณ์', 'text', { required: true }),
      f('sku', 'รหัสสินค้า (SKU)', 'text', { required: true, unique: true }),
      f('category', 'หมวดผลิตภัณฑ์', 'select', { options: ['Smart MS-Box', 'CCTV/เฝ้าระวัง', 'เสียงประกาศ (PA)', 'ตรวจวัดอากาศ/สิ่งแวดล้อม', 'จอ LED', 'เครือข่าย/Fiber Optic', 'โดรนและอุปกรณ์', 'Smart City/Monitoring', 'อะไหล่', 'อื่นๆ'] }),
      f('kind', 'ชนิด', 'select', { options: ['สินค้า', 'อุปกรณ์', 'อะไหล่', 'วัสดุสิ้นเปลือง'] }),
      f('brand', 'ยี่ห้อ'),
      f('model', 'รุ่น'),
      f('unit', 'หน่วยนับ'),
      f('trackSerial', 'ติดตาม Serial Number', 'boolean'),
      f('warrantyMonths', 'ระยะรับประกัน (เดือน)', 'number'),
      f('minStock', 'จุดสั่งซื้อ/สต็อกขั้นต่ำ', 'number'),
      f('vendor', 'ผู้ขายหลัก', 'ref', { ref: 'vendors' }),
      f('note', 'หมายเหตุ', 'textarea'),
    ],
  },
  serials: {
    key: 'serials',
    label: 'Serial Number',
    resource: 'assets',
    prefix: 'SER',
    title: 'serialNo',
    cols: ['serialNo', 'item', 'status', 'customer', 'site', 'warrantyEnd'],
    filters: ['status'],
    scoped: true,
    fields: [
      f('serialNo', 'Serial Number', 'text', { required: true, unique: true }),
      f('item', 'สินค้า/รุ่น', 'ref', { ref: 'items', required: true }),
      f('status', 'สถานะ', 'select', { options: ['ในคลัง', 'ส่งออกไปหน้างาน', 'ติดตั้งแล้ว', 'ส่งซ่อม', 'เปลี่ยนแล้ว', 'ปลดระวาง'], required: true }),
      f('warehouse', 'คลังปัจจุบัน', 'ref', { ref: 'warehouses' }),
      f('customer', 'ลูกค้า', 'ref', { ref: 'customers' }),
      f('project', 'โครงการ', 'ref', { ref: 'projects' }),
      f('site', 'ไซต์', 'ref', { ref: 'sites' }),
      f('location', 'จุดติดตั้ง'),
      f('receivedDate', 'วันที่รับเข้า', 'date'),
      f('installedDate', 'วันที่ติดตั้ง', 'date'),
      f('warrantyStart', 'เริ่มรับประกัน', 'date'),
      f('warrantyEnd', 'สิ้นสุดรับประกัน', 'date'),
      f('note', 'หมายเหตุ', 'textarea'),
    ],
  },
  projects: {
    key: 'projects',
    label: 'โครงการ',
    resource: 'projects',
    prefix: 'PRJ',
    title: 'name',
    cols: ['code', 'name', 'customer', 'type', 'manager', 'stepLabel'],
    filters: ['type'],
    scoped: true,
    fields: [
      f('name', 'ชื่อโครงการ', 'text', { required: true }),
      f('customer', 'ลูกค้า', 'ref', { ref: 'customers', required: true }),
      f('type', 'ประเภทโครงการ', 'select', { options: ['โครงการขนาดใหญ่', 'งานใช้อุปกรณ์พิเศษ', 'ติดตั้งทั่วไป', 'อื่นๆ'] }),
      f('site', 'ไซต์หลัก', 'ref', { ref: 'sites' }),
      f('manager', 'ผู้จัดการโครงการ', 'ref', { ref: 'users' }),
      f('team', 'ทีมรับผิดชอบ', 'select', TEAM),
      f('track', 'เส้นทางโครงการ', 'select', {
        options: ['มาตรฐาน', 'ราชการ (ประมูล)', 'ร่วมทุน SJP–NT', 'R&D'],
        help: 'เลือก "ราชการ (ประมูล)" เพื่อใช้เกณฑ์ defended ICT และขั้นตอนประมูล',
      }),
      f('contractNo', 'เลขที่สัญญา', 'text', { help: 'อ้างอิงในเอกสารส่งมอบและใบแจ้งหนี้' }),
      f('poNo', 'เลขที่ PO ลูกค้า'),
      f('value', 'มูลค่าโครงการ (บาท)', 'number', { help: 'ใช้ในภาพรวมการเงินและรายงาน' }),
      f('contractStart', 'วันเริ่มสัญญา', 'date'),
      f('contractEnd', 'วันสิ้นสุดสัญญา', 'date'),
      f('sharePercent', 'ส่วนแบ่งรายได้ SJP (%)', 'number', { help: 'ใช้เมื่อเป็นโครงการร่วมทุน/พาร์ตเนอร์' }),
      f('boq', 'BOQ (รายการอุปกรณ์ที่ต้องใช้)', 'rows', {
        cols: [
          { key: 'item', label: 'สินค้า/อุปกรณ์', type: 'ref', ref: 'items', required: true },
          { key: 'desc', label: 'รายละเอียด', type: 'text' },
          { key: 'qty', label: 'จำนวน', type: 'number', required: true },
        ],
      }),
      f('note', 'หมายเหตุ', 'textarea'),
    ],
  },
  tickets: {
    key: 'tickets',
    label: 'Service Ticket',
    resource: 'tickets',
    prefix: 'TK',
    title: 'title',
    cols: ['code', 'title', 'customer', 'site', 'category', 'priority', 'status', 'assignee'],
    filters: ['status', 'category', 'priority'],
    scoped: true,
    fields: [
      f('title', 'หัวข้อ/ชื่อจุด', 'text', { required: true }),
      f('reportedBy', 'ผู้แจ้ง', 'text', { required: true }),
      f('channel', 'ช่องทางแจ้ง', 'select', { options: ['โทรศัพท์', 'LINE', 'อีเมล', 'เว็บ/ระบบ', 'หน้างาน', 'อื่นๆ'] }),
      f('receivedAt', 'วันเวลาที่รับเรื่อง', 'datetime', { required: true, help: 'ใช้คำนวณอายุเคสและเวลา SLA' }),
      f('customer', 'ลูกค้า', 'ref', { ref: 'customers', required: true }),
      f('project', 'โครงการ', 'ref', { ref: 'projects' }),
      f('site', 'ไซต์', 'ref', { ref: 'sites', required: true, optionFilter: { by: 'customer', targetField: 'customer' }, help: 'ต้องตรงกับไซต์ของลูกค้า ระบบจะตรวจให้' }),
      f('point', 'จุดติดตั้ง'),
      f('circuitNo', 'หมายเลขวงจร'),
      f('item', 'อุปกรณ์/รุ่น', 'ref', { ref: 'items' }),
      f('serial', 'Serial Number', 'ref', { ref: 'serials' }),
      f('category', 'หมวดงาน', 'select', { options: ['IT Support', 'Hardware', 'Software', 'Network', 'CCTV', 'PA', 'Spare Part', 'PM', 'อื่นๆ'], required: true }),
      f('priority', 'ความเร่งด่วน', 'select', { options: ['ต่ำ', 'ปกติ', 'สูง', 'เร่งด่วน'], required: true, help: 'SLA: เร่งด่วน 4 ชม. · สูง 8 ชม. · ปกติ 24 ชม. · ต่ำ 72 ชม.' }),
      f('symptom', 'อาการ', 'textarea', { required: true }),
      f('description', 'รายละเอียดเพิ่มเติม', 'textarea'),
      f('initialFinding', 'ผลตรวจเบื้องต้น', 'textarea'),
      f('cause', 'สาเหตุ', 'textarea'),
      f('resolution', 'วิธีแก้ไข', 'textarea'),
      f('remarks', 'ข้อสังเกต', 'textarea'),
      f('team', 'ทีมรับผิดชอบ', 'select', TEAM),
      f('assignee', 'ผู้รับผิดชอบ', 'ref', { ref: 'users' }),
      f('attachments', 'รูปถ่าย/เอกสาร/หลักฐาน', 'file'),
    ],
  },
  purchaseOrders: {
    key: 'purchaseOrders',
    label: 'ใบสั่งซื้อ',
    resource: 'purchase',
    prefix: 'PO',
    title: 'code',
    cols: ['code', 'vendor', 'project', 'orderDate', 'dueDate', 'status'],
    filters: ['status'],
    scoped: true,
    fields: [
      f('vendor', 'ผู้ขาย', 'ref', { ref: 'vendors', required: true }),
      f('project', 'โครงการ', 'ref', { ref: 'projects' }),
      f('orderDate', 'วันที่สั่งซื้อ', 'date'),
      f('dueDate', 'กำหนดส่ง', 'date'),
      f('lines', 'รายการสั่งซื้อ', 'rows', {
        required: true,
        cols: [
          { key: 'item', label: 'สินค้า', type: 'ref', ref: 'items', required: true },
          { key: 'qty', label: 'จำนวน', type: 'number', required: true },
          { key: 'unitPrice', label: 'ราคา/หน่วย', type: 'number' },
        ],
      }),
      f('note', 'หมายเหตุ', 'textarea'),
      f('attachments', 'ไฟล์แนบ', 'file'),
    ],
  },
  warehouses: {
    key: 'warehouses',
    label: 'คลังสินค้า',
    resource: 'warehouse',
    prefix: 'WH',
    title: 'name',
    cols: ['code', 'name', 'kind'],
    filters: [],
    fields: [
      f('name', 'ชื่อคลัง', 'text', { required: true }),
      f('kind', 'ประเภทคลัง', 'select', { options: ['คลังกลาง', 'คลังโครงการ', 'คลังรอซ่อม', 'คลังรถช่าง'] }),
      f('note', 'หมายเหตุ', 'textarea'),
    ],
  },
  stockMoves: {
    key: 'stockMoves',
    label: 'รายการเคลื่อนไหวสต็อก',
    resource: 'warehouse',
    prefix: 'MV',
    title: 'code',
    cols: ['code', 'date', 'type', 'item', 'qty'],
    filters: ['type'],
    scoped: true,
    system: true,
    fields: [
      f('type', 'ประเภท', 'select', { hidden: true }),
      f('item', 'สินค้า', 'ref', { ref: 'items', hidden: true }),
      f('from', 'จากคลัง', 'ref', { ref: 'warehouses', hidden: true }),
      f('to', 'ไปคลัง', 'ref', { ref: 'warehouses', hidden: true }),
      f('project', 'โครงการ', 'ref', { ref: 'projects', hidden: true }),
      f('site', 'ไซต์', 'ref', { ref: 'sites', hidden: true }),
      f('ticket', 'Ticket', 'ref', { ref: 'tickets', hidden: true }),
      f('po', 'ใบสั่งซื้อ', 'ref', { ref: 'purchaseOrders', hidden: true }),
    ],
  },
  pmTemplates: {
    key: 'pmTemplates',
    label: 'แม่แบบรายการตรวจ PM',
    resource: 'pm',
    prefix: 'PMT',
    title: 'name',
    cols: ['name', 'category'],
    filters: [],
    fields: [
      f('name', 'ชื่อแม่แบบ', 'text', { required: true }),
      f('category', 'ประเภทอุปกรณ์', 'select', { options: ['CCTV/เฝ้าระวัง', 'เสียงประกาศ (PA)', 'ตรวจวัดอากาศ/สิ่งแวดล้อม', 'จอ LED', 'เครือข่าย/Fiber Optic', 'Smart MS-Box', 'โดรนและอุปกรณ์', 'อื่นๆ'] }),
    ],
  },
  pmPlans: {
    key: 'pmPlans',
    label: 'แผน PM',
    resource: 'pm',
    prefix: 'PMP',
    title: 'name',
    cols: ['code', 'name', 'site', 'frequency', 'template', 'active'],
    filters: ['frequency'],
    scoped: true,
    fields: [
      f('name', 'ชื่อแผน', 'text', { required: true }),
      f('site', 'ไซต์', 'ref', { ref: 'sites', required: true }),
      f('customer', 'ลูกค้า', 'ref', { ref: 'customers' }),
      f('contractNo', 'สัญญาบริการ'),
      f('frequency', 'รอบการตรวจ', 'select', { options: ['รายวัน', 'รายสัปดาห์', 'รายเดือน', 'รายไตรมาส'], required: true }),
      f('template', 'แม่แบบรายการตรวจ', 'ref', { ref: 'pmTemplates', required: true }),
      f('team', 'ทีมรับผิดชอบ', 'select', TEAM),
      f('assignee', 'ผู้รับผิดชอบ', 'ref', { ref: 'users' }),
      f('startDate', 'เริ่มรอบแรก', 'date', { required: true }),
      f('active', 'ใช้งาน', 'boolean'),
    ],
  },
  pmRecords: {
    key: 'pmRecords',
    label: 'งาน PM',
    resource: 'pm',
    prefix: 'PMR',
    title: 'code',
    cols: ['code', 'plan', 'site', 'dueDate', 'status'],
    filters: ['status'],
    scoped: true,
    system: true,
    fields: [
      f('plan', 'แผน PM', 'ref', { ref: 'pmPlans', hidden: true }),
      f('site', 'ไซต์', 'ref', { ref: 'sites', hidden: true }),
      f('assignee', 'ผู้รับผิดชอบ', 'ref', { ref: 'users', hidden: true }),
      f('dueDate', 'กำหนด', 'date', { hidden: true }),
      f('status', 'สถานะ', 'select', { hidden: true }),
    ],
  },
  invoices: {
    key: 'invoices',
    label: 'ใบแจ้งหนี้/วางบิล',
    resource: 'accounting',
    prefix: 'INV',
    title: 'code',
    cols: ['code', 'customer', 'project', 'issueDate', 'dueDate', 'total', 'status'],
    filters: ['status', 'customer'],
    fields: [
      f('customer', 'ลูกค้า', 'ref', { ref: 'customers', required: true }),
      f('project', 'โครงการ', 'ref', { ref: 'projects' }),
      f('issueDate', 'วันที่ออกเอกสาร', 'date', { required: true }),
      f('dueDate', 'ครบกำหนดชำระ', 'date', { required: true }),
      f('subtotal', 'ยอดก่อน VAT', 'number', { required: true }),
      f('vat', 'VAT', 'number'),
      f('total', 'ยอดรวมสุทธิ', 'number', { required: true }),
      f('note', 'หมายเหตุ', 'textarea'),
      f('attachments', 'ไฟล์แนบ', 'file'),
    ],
  },
  receipts: {
    key: 'receipts',
    label: 'ใบเสร็จ/รับชำระ',
    resource: 'accounting',
    prefix: 'RCP',
    title: 'code',
    cols: ['code', 'invoice', 'customer', 'paidDate', 'amount', 'method'],
    filters: ['method', 'customer'],
    fields: [
      f('invoice', 'อ้างอิงใบแจ้งหนี้', 'ref', { ref: 'invoices', required: true }),
      f('customer', 'ลูกค้า', 'ref', { ref: 'customers', required: true }),
      f('paidDate', 'วันที่รับชำระ', 'date', { required: true }),
      f('amount', 'จำนวนเงิน', 'number', { required: true }),
      f('method', 'ช่องทางชำระ', 'select', { options: ['เงินสด', 'โอนเงิน', 'บัตร', 'เช็ค'], required: true }),
      f('reference', 'เลขที่อ้างอิงการโอน/เช็ค'),
      f('note', 'หมายเหตุ', 'textarea'),
      f('attachments', 'หลักฐานการชำระ', 'file'),
    ],
  },
  expenses: {
    key: 'expenses',
    label: 'ค่าใช้จ่าย',
    resource: 'accounting',
    prefix: 'EXP',
    title: 'code',
    cols: ['code', 'date', 'category', 'vendor', 'project', 'amount', 'status'],
    filters: ['status', 'category'],
    scoped: true,
    fields: [
      f('date', 'วันที่', 'date', { required: true }),
      f('category', 'หมวดค่าใช้จ่าย', 'select', { options: ['วัสดุ/อะไหล่', 'เดินทาง', 'ค่าบริการ', 'ค่าจ้าง', 'สำนักงาน', 'อื่นๆ'], required: true }),
      f('vendor', 'ผู้ขาย/ผู้รับเงิน', 'ref', { ref: 'vendors' }),
      f('project', 'โครงการ', 'ref', { ref: 'projects' }),
      f('amount', 'จำนวนเงิน', 'number', { required: true }),
      f('payer', 'ผู้จ่าย/ผู้รับผิดชอบ', 'ref', { ref: 'users' }),
      f('note', 'รายละเอียด', 'textarea'),
      f('attachments', 'ใบเสร็จ/หลักฐาน', 'file'),
    ],
  },
  vehicles: {
    key: 'vehicles',
    label: 'รถบริษัท',
    resource: 'vehicles',
    prefix: 'VEH',
    title: 'name',
    cols: ['code', 'name', 'plateNo', 'type', 'seats', 'status'],
    filters: ['type', 'status'],
    system: true,
    fields: [
      f('name', 'ชื่อรถ/รุ่น', 'text', { required: true }),
      f('plateNo', 'ทะเบียนรถ', 'text', { required: true, unique: true }),
      f('type', 'ประเภทรถ', 'select', { options: ['รถเก๋ง', 'รถกระบะ', 'รถตู้', 'อื่นๆ'], required: true }),
      f('seats', 'จำนวนที่นั่ง', 'number'),
      f('driver', 'พนักงานขับประจำ', 'ref', { ref: 'users' }),
      f('status', 'สถานะรถ', 'select', { options: ['พร้อมใช้', 'ซ่อมบำรุง', 'ไม่พร้อมใช้'], required: true }),
      f('note', 'หมายเหตุ', 'textarea'),
    ],
  },
  vehicleBookings: {
    key: 'vehicleBookings',
    label: 'จองรถ',
    resource: 'vehicleBookings',
    prefix: 'VBK',
    title: 'title',
    cols: ['code', 'title', 'vehicle', 'requester', 'startAt', 'endAt', 'status'],
    filters: ['status', 'vehicle'],
    system: true,
    fields: [
      f('title', 'วัตถุประสงค์การเดินทาง', 'text', { required: true }),
      f('vehicle', 'รถที่จอง', 'ref', { ref: 'vehicles', required: true }),
      f('requester', 'ผู้จอง', 'text', { required: true }),
      f('department', 'แผนก', 'text'),
      f('destination', 'สถานที่ปลายทาง', 'text', { required: true }),
      f('startAt', 'วันเวลาเริ่ม', 'datetime', { required: true }),
      f('endAt', 'วันเวลาสิ้นสุด', 'datetime', { required: true }),
      f('passengers', 'จำนวนผู้โดยสาร', 'number'),
      f('driver', 'พนักงานขับรถ', 'ref', { ref: 'users' }),
      f('status', 'สถานะการจอง', 'select', { options: ['รออนุมัติ', 'อนุมัติแล้ว', 'ไม่อนุมัติ', 'ยกเลิก', 'เสร็จสิ้น'], required: true }),
      f('note', 'รายละเอียดเพิ่มเติม', 'textarea'),
    ],
  },
  revenueShares: {
    key: 'revenueShares',
    label: 'แบ่งรายได้ (Ledger)',
    resource: 'accounting',
    prefix: 'REV',
    title: 'code',
    cols: ['code', 'project', 'period', 'partner', 'gross', 'sjpShare', 'partnerShare', 'status'],
    filters: ['partner', 'status'],
    scoped: true,
    fields: [
      f('project', 'โครงการ', 'ref', { ref: 'projects', required: true }),
      f('period', 'งวด (YYYY-MM)', 'text', { required: true, help: 'ระบุเดือนที่รับรู้รายได้ เช่น 2026-11' }),
      f('partner', 'คู่สัญญา/พาร์ตเนอร์', 'select', { options: ['SJP', 'NT', 'อื่นๆ'] }),
      f('gross', 'ยอดรับรู้รายได้', 'number', { required: true }),
      f('sjpShare', 'ส่วนของ SJP', 'number'),
      f('partnerShare', 'ส่วนของพาร์ตเนอร์', 'number'),
      f('status', 'สถานะ', 'select', { options: ['รอจ่าย', 'จ่ายแล้ว', 'ยกเลิก'], required: true }),
      f('paidDate', 'วันที่จ่าย', 'date'),
      f('note', 'หมายเหตุ', 'textarea'),
      f('attachments', 'หลักฐาน', 'file'),
    ],
  },
};

export const findEntity = (key: string): EntityDef | undefined =>
  Object.prototype.hasOwnProperty.call(ENTITY_DEFS, key) ? ENTITY_DEFS[key] : undefined;

export const getEntity = (key: string): EntityDef => {
  const def = findEntity(key);
  if (!def) throw new NotFoundException(`ไม่พบชนิดข้อมูล ${key}`);
  return def;
};

// Snapshots are used by the metadata editor so a built-in definition can be reset
// without restarting the process and without losing the static source of truth.
export const DEFAULT_ENTITY_DEFS: Record<string, EntityDef> = JSON.parse(JSON.stringify(ENTITY_DEFS));
export const DEFAULT_WORKFLOWS: typeof WORKFLOWS = JSON.parse(JSON.stringify(WORKFLOWS));
export const DEFAULT_LISTS = JSON.parse(JSON.stringify(LISTS)) as typeof LISTS;
export const DEFAULT_RESOURCE_LABELS = { ...RESOURCE_LABELS };

export const NAV = [
  ['ภาพรวม', [['/', 'หน้าแรก (ภาพรวม)'], ['/my', 'งานของฉัน']]],
  ['งานขาย/โครงการ', [['/projects', 'โครงการ'], ['/calendar', 'ปฏิทินงาน']]],
  ['บริการ', [['/tickets', 'แจ้งซ่อม / Service Ticket'], ['/pm', 'งาน PM']]],
  ['คลัง/จัดซื้อ', [['/purchase-orders', 'ใบสั่งซื้อ'], ['/warehouse', 'คลังสินค้า']]],
  ['บัญชี/การเงิน', [['/entities/invoices', 'ใบแจ้งหนี้/วางบิล'], ['/entities/receipts', 'ใบเสร็จ/รับชำระ'], ['/entities/expenses', 'ค่าใช้จ่าย']]],
  ['ข้อมูลหลัก', [['/entities/customers', 'ลูกค้า'], ['/entities/vendors', 'ผู้ขาย'], ['/entities/contacts', 'ผู้ติดต่อ'], ['/entities/sites', 'ไซต์งาน'], ['/entities/items', 'สินค้า/อุปกรณ์'], ['/entities/serials', 'Serial Number']]],
  ['ระบบ', [['/reports', 'รายงานและส่งออก'], ['/settings', 'ตั้งค่าผู้ใช้/สิทธิ์']]],
] as const;
