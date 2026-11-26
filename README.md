# SJP ERP

ระบบ ERP สำหรับงานโครงการ / บริการ / คลัง / จัดซื้อ / PM — ออกแบบให้เป็น **metadata-driven ERP** ที่ปรับฟิลด์ workflow สิทธิ์ และโมดูลเพิ่มเติมได้

## โครงสร้าง

| โฟลเดอร์ | รายละเอียด |
| --- | --- |
| `web/` | Angular 22 frontend (standalone components, signals) |
| `server/` | NestJS 12 API + SQLite (Drizzle ORM) + JWT auth |
| `app/` | React + Vite เวอร์ชันเดิม เก็บไว้เป็น reference ระหว่าง migration |

## การรัน

```bash
npm run install:all

# คัดลอกค่าตั้งต้น (แก้ JWT_SECRET ก่อนใช้งานจริง)
copy server\.env.example server\.env

# terminal 1 — API (http://localhost:3000/api)
npm run dev:server

# terminal 2 — Angular (http://localhost:4200)
npm run dev:web
```

ครั้งแรกเปิด `http://localhost:4200` ระบบจะให้สร้างผู้ดูแลระบบคนแรก

- ฐานข้อมูล SQLite: `server/data/sjp.sqlite` (สร้างอัตโนมัติ)
- API prefix: `/api` · Health: `GET /api/health`
- Angular dev server proxy `/api` → `localhost:3000` (ดู `web/proxy.conf.json`)
- PDF ฝั่งเซิร์ฟเวอร์ใช้ Chrome/Edge/Chromium แบบ headless — ตั้ง `PDF_BROWSER_PATH` หากไม่ได้อยู่ path มาตรฐาน
- **production ต้องตั้ง `JWT_SECRET` ยาว ≥ 32 ตัวอักษร** — ถ้าไม่มี/เป็น placeholder เซิร์ฟเวอร์จะไม่ start; โหมด dev จะสร้าง secret ชั่วคราวและ session จะหลุดเมื่อ restart
- Login/Setup ถูกจำกัด 5 ครั้ง/นาที (Throttler) และสิทธิ์จัดการผู้ใช้/บทบาทแยกจาก `settings` แล้ว (`users.*`, `roles.*`) — เพดานคำขอทั่วไป 120/นาที ปรับได้ด้วย `THROTTLE_LIMIT` (ใช้เมื่อ import/ทดสอบจำนวนมาก)
- Acceptance tests: `npm --prefix server run test:e2e` รวม NAV-01 (501 โมดูล + สิทธิ์), GRID-01 (80 ฟิลด์/100,000 แถว) และฟิลด์/relation lifecycle — ใช้ฐานข้อมูลชั่วคราวและลบทิ้งเมื่อจบ; UI 100k วัดจริงด้วยเบราว์เซอร์ (ดู `docs/custom-erp-spec-status-2026-11-23.md`)
- Webhook ภายนอกบล็อก localhost/private IP โดยค่าเริ่มต้น — ตั้ง `WEBHOOK_ALLOW_PRIVATE=true` เฉพาะกรณีเชื่อมระบบภายในที่เชื่อถือได้
- ไฟล์สำรองถูกเข้ารหัส AES-256-GCM และ redact SMTP/LINE/webhook secret — ต้องเก็บ `BACKUP_ENCRYPTION_KEY` (หรือ `JWT_SECRET`) ให้ปลอดภัย เพราะใช้ถอดรหัสไฟล์สำรอง
- Login ใช้ HttpOnly cookie + CSRF token; ตั้ง `COOKIE_SAME_SITE`/`COOKIE_SECURE` ให้เหมาะกับโดเมนที่ deploy — ถ้า frontend/API ต่างโดเมนให้ใช้ `COOKIE_SAME_SITE=none` พร้อม HTTPS
- CSP ของ frontend ถูกใส่ใน `web/src/index.production.html` และตัวอย่าง reverse proxy อยู่ที่ `deploy/nginx/sjp-erp.conf`; ตรวจด้วย `npm run csp:check` ใน `web/`
- อีเมล/LINE ตั้งค่าได้ที่ Settings → แจ้งเตือน หรือใช้ env สำรอง: `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASS`, `MAIL_FROM`, `MAIL_TO`, `LINE_CHANNEL_TOKEN`, `LINE_TO`

## Project Guardian (ตรวจสุขภาพโปรเจ็ค)

- Agent สำหรับตรวจแบบอ่านอย่างเดียว: `.opencode/agents/project-guardian.md`
- เรียกจาก TUI ด้วยคำสั่ง: `/check-project` (หรือ `/check-project โฟกัส auth`)
- ตรวจ build/tests/dependency/code markers/hygiene ด้วย: `npm run health`
- รายงานถูกเก็บที่ `checks/reports/health-*.md`
- ตั้งให้ตรวจอัตโนมัติทุกวัน (Windows Task Scheduler) ด้วย:
  ```powershell
  powershell -NoProfile -ExecutionPolicy Bypass -File scripts\install-health-task.ps1 -Time 08:00
  ```
  ยกเลิกด้วย `-Remove` — ตัว scheduled task รันสคริปต์ health check ส่วนการวิเคราะห์เชิงลึกใช้ agent ตอนเรียก `/check-project`

## Skills & architecture

- ชุดสกิล UI/UX ที่ vendor ไว้ในโปรเจ็ค: `.opencode/skills/` — ดูวิธีใช้/อัปเดตที่ `.opencode/SKILLS.md`
- Sync จาก upstream แบบ pin commit: `powershell -NoProfile -ExecutionPolicy Bypass -File scripts\sync-opencode-skills.ps1`
- Interactive architecture diagram: `docs/architecture/architecture.html` (คำอธิบาย: `docs/architecture/architecture.md`)
- UI/UX + accessibility audit รอบล่าสุด: `docs/ui-ux-skill-audit-2026-11-13.md`

## สถานะ migration

เสร็จใน base นี้:
- [x] Angular shell/login/dashboard + responsive theme
- [x] NestJS + SQLite + Drizzle + JWT + first-run admin
- [x] Metadata registry + generic records API (validation / permission / scope / audit)
- [x] Master data, Ticket workflow, Project 13 steps, Purchase/Receive, Stock/Serial, PM, Reports, Users/Roles
- [x] **Workspace หลายองค์กร (แบบ A)**: ตาราง workspaces/membership, active workspace ต่อผู้ใช้, header `X-Workspace-ID` ตรวจสิทธิ์ทุกคำขอ, scope records/saved views/audit/events/approvals/files, เลขเอกสารแยกต่อ Workspace, ตัวสลับ Workspace ใน topbar, หน้าจอจัดการ Workspace/สมาชิกใน Settings, สำรอง–กู้คืนรวม Workspace, backfill ข้อมูลเดิมเข้า `default`; โมดูล/บทบาทยังใช้ร่วมทุก Workspace
- [x] **วงจรโมดูล ร่าง/เผยแพร่/เก็บถาวร**: `status` ต่อโมดูล, draft/archived ถูกตัดจาก meta/search และลิงก์ตรง (403) ทุกบทบาท, `/meta/config` ยังจัดการได้, Module Builder มีปุ่มเผยแพร่/ย้ายเป็นร่าง/เก็บถาวร
- [x] **App Launcher** (`/apps`): ค้นหาโมดูลไทย/อังกฤษ + ชื่อเรียกอื่น, กรองหมวด, รายการโปรด/เปิดล่าสุด, โหลดเพิ่มครั้งละ 24, จำกัดตามสิทธิ์จริง (API ไม่ส่งโมดูลที่อ่านไม่ได้), ลิงก์ตรงถูกปฏิเสธแบบไม่เปิดเผยข้อมูล
- [x] **Sidebar ตามโมดูลปัจจุบัน**: แสดงเฉพาะหมวดของหน้าที่เปิด พร้อมจำกัดสิทธิ์, ปักหมุด/ปิดกั้นต่อผู้ใช้แยกตามบัญชี (localStorage key ต่อ user), ปุ่ม "แอปทั้งหมด" ทุกหน้า, คืนโฟกัสเมื่อปิดเมนูจอแคบ
- [x] **Grid แบบ server-side**: ค้นหา/กรอง/เรียง/แบ่งหน้าจากทั้งชุดข้อมูลตามสิทธิ์ (ไม่ใช่ 500 แถวแรก), เรียงหลายคอลัมน์ + NULL ท้าย, ตัวกรองกลุ่ม AND/OR, ตรึงหัวตาราง/คอลัมน์รหัส, ชิดขวาตัวเลข, ตัวกรองที่ไม่รู้จักถูกปฏิเสธพร้อมบอกให้ปรับมุมมอง
- [x] **Inline Editing**: F2/Enter/ดับเบิลคลิกเพื่อแก้, Enter/Tab ยืนยัน, Esc ยกเลิก, ไม่บันทึกเมื่อคลิกออก, ตรวจชนิด/ช่วงค่า, optimistic concurrency (`_expectedUpdatedAt` + 409) พร้อมเทียบค่าล่าสุด/ค่าที่กรอก, แจ้งเตือนด้วย aria-live และคืนโฟกัส
- [x] **กันข้อมูลหายจากฟอร์ม**: เตือนเมื่อปิด/ออกจากหน้าทั้งที่ยังมีร่าง, ยืนยันก่อนทิ้ง, ป้องกัน beforeunload, ส่งเฉพาะค่าที่เปลี่ยน และ retry อย่างปลอดภัยเมื่อไม่แน่ใจว่าบันทึกสำเร็จ
- [x] **Saved View ฝั่งเซิร์ฟเวอร์**: `เฉพาะฉัน`/`แชร์กับทีม` (แชร์ต้องมีสิทธิ์แก้การตั้งค่า), ตรวจฟิลด์กับชุดข้อมูล, ป้าย `ยังไม่บันทึกมุมมอง`, คืนตำแหน่งด้วย Record ID, แชร์ไม่ให้สิทธิ์อ่านข้อมูลเพิ่ม — ใช้ครบ Ticket/PM/คลัง/ใบสั่งซื้อ, ซ่อมมุมมองที่ฟิลด์หายให้อัตโนมัติ, ส่งออก/คัดลอกทั้งชุดที่กรองแล้ว (เพดาน 10,000 แถว/ครั้ง)
- [x] **ตัวกรองขั้นสูง + ยอดรวมทั้งชุด**: AND/OR สูงสุด 5+3 เงื่อนไขพร้อมสรุปวงเล็บ, ยอดรวมคอลัมน์ตัวเลขและจำนวน/ยอดรวมรายกลุ่ม (สูงสุด 2 ระดับ) คำนวณจากทั้งชุดที่กรองแล้ว ไม่ใช่หน้าปัจจุบัน
- [x] **Grid กลุ่มแบบ inline + จัดคอลัมน์**: แถวหัวกลุ่มพับ/กางพร้อมจำนวน/ยอดรวมทั้งชุด, ลากหรือปุ่มเลื่อนลำดับคอลัมน์, ปรับความกว้างด้วยเมาส์หรือลูกศร, จำค่าต่อตาราง, รีเซ็ตได้
- [x] **Kanban สำหรับใบสั่งซื้อ**: สลับ Grid/Kanban, เลนตาม workflow, นับเฉพาะที่อ่านได้, ลาก/เมนู "ย้ายไปสถานะ…" ใช้กฎเดียวกัน, ปฏิเสธแล้วการ์ดกลับเลนเดิมพร้อมเหตุผล, ซ่อนเป้าหมายที่ต้องสิทธิ์ปิดรายการ
- [x] **Schema Drawer**: เพิ่มฟิลด์จากหัวตาราง/ปุ่มจัดการฟิลด์, ID ถาวรแยกจากป้ายชื่อ, ตรวจชื่อซ้ำแบบไม่สนตัวพิมพ์, สรุปผลกระทบก่อนตั้งบังคับกรอก (รวม View/Workflow ที่ใช้ฟิลด์), Relation + ลิงก์ย้อนกลับแบบ atomic, Relation หลายรายการสองทาง (many-to-many) ที่ซิงก์อัตโนมัติ, **สิทธิ์ต่อตัวเลือก (option roles) ตั้งได้ทั้งตอนสร้างและแก้ฟิลด์เดิม**, **picker กรองตามกฎธุรกิจ (site ตาม customer)**, เปลี่ยนชนิดฟิลด์พร้อมแปลงค่า/ยืนยันการล้างค่า, เก็บถาวร/คืนสถานะฟิลด์โดยไม่เสียข้อมูล, แสดงเฉพาะในมุมมองปัจจุบัน (ไม่เปลี่ยนเลย์เอาต์ของคนอื่น), โฟกัส/Esc/คืนโฟกัสตามมาตรฐาน dialog
- [x] ความถูกต้องพื้นฐาน: local date-only, ref/select/rows validation, cross-customer/site check, ETag off, CSV export
- [x] Module Builder: สร้างโมดูลเอง, เพิ่ม/ซ่อนฟิลด์, เลือกคอลัมน์/ตัวกรอง, กำหนดสิทธิ์รายบทบาท จากหน้า Settings
- [x] **alias โมดูลที่ผู้ใช้แก้เองได้**: สูงสุด 20 คำ, ใช้ค้นใน App Launcher และช่องค้นหาเมนู (e2e + เบราว์เซอร์)
- [x] Workflow editor แบบฟอร์ม: เพิ่ม/แก้สถานะ, เส้นทางถัดไป, ฟิลด์บังคับ, ผู้อนุมัติ (มี JSON ขั้นสูงสำหรับโครงการ)
- [x] Approval flow: คำขออนุมัติค้าง (request/decide) สำหรับ workflow, ใบสั่งซื้อ และขั้นตอนโครงการ
- [x] หน้าคำขออนุมัติ + แจ้งเตือนคำขอค้างในหน้าเอกสารและ Dashboard
- [x] ไฟล์แนบจริง: upload/download พร้อมmetadata และปุ่มพิมพ์/Save as PDF สำหรับเอกสารหลัก
- [x] Backup/Restore ข้อมูล JSON และนำเข้าข้อมูลเอกสารจาก React เดิม
- [x] Enterprise UI v3: neutral operations console, sidebar 248px/rail 60px, topbar 56px, dense tables/forms, KPI strip + card-less dashboard, light/dark — อ้างอิง Stripe, Salesforce SLDS, SAP Fiori, NetSuite Redwood, Linear, Odoo 18 (ดู `DESIGN.md`)
- [x] Settings แบบ 3 หมวด/10 หน้า (vertical sub-nav), density toggle (กระชับ/สบาย), saved views + ตัวเลือกคอลัมน์ในตารางพร้อมจำค่าต่อตาราง, ลากจัดลำดับ favorites
- [x] Role-aware dashboard/nav, Role Editor แบบ grouped/preset/search + card view บนมือถือ, Module Builder แบบ workbench (module list + tabs + field list/modal), template, group/icon/nav label/description, role access, duplicate/import/export JSON, field advanced options
- [x] Responsive audit 320–1920px: แก้ text truncation/overflow/wrapping ทั้งโปรเจ็ค, quick label/nav label สั้น, ตารางกว้างเลื่อนแนวนอน, ปุ่ม/ฟอร์ม heights สม่ำเสมอ
- [x] Sidebar แบบ accordion 6 หมวด เปิดได้ทีละหมวด + ปักหมุด (แสดงเมื่อ hover) + ค้นหาเมนู + ย่อเป็น icon rail พร้อม flyout + drawer บนมือถือ, Quick search ด้วย Ctrl K, Dashboard ใหม่
- [x] โต๊ะทำงาน (Workspace): ลาก/ขยาย/ซ่อนการ์ดงานได้อิสระ บันทึกเลย์เอาต์ต่อผู้ใช้ (z-order, ตำแหน่ง, ความกว้าง), จัดเรียงอัตโนมัติ/รีเซ็ต, รองรับคีย์บอร์ด และเรียงเป็นคอลัมน์บนมือถือ
- [x] Quick Create ตามบริบทของหน้า (แจ้งซ่อม/ใบสั่งซื้อ/ใบแจ้งหนี้/รับชำระ/ค่าใช้จ่าย/โครงการ/จองรถ) และเปิดฟอร์มด้วย `?new=1`
- [x] ปฏิทินงานรวมนัดหมาย Ticket, งาน PM, ขั้นตอนโครงการ, กำหนดส่งใบสั่งซื้อ และจองรถบริษัท
- [x] ระบบจองรถบริษัท: หารถว่างตามช่วงเวลา/จำนวนที่นั่ง, การ์ดจองด่วน, ตารางว่างรายชั่วโมงแบบแท็บ, ตรวจช่วงเวลาทับซ้อน, อนุมัติ/ไม่อนุมัติ + แจ้งเตือน, แถบสัปดาห์, ค้นหา/กรอง/เฉพาะของฉัน, ส่งออก CSV, สถานะกำลังใช้งาน/เลยเวลาคืน และเชื่อมปฏิทิน
- [x] SLA บน Ticket (4/8/24/72 ชม. ตามความเร่งด่วน) + แจ้งเตือนเกินกำหนดผ่านกระดิ่ง (ตัวเลขยังไม่ยืนยัน ปิดได้ที่หน้าข้อมูลบริษัท ค่าเริ่มต้นเปิด)
- [x] Module Builder: ลากจัดลำดับฟิลด์, ปุ่ม ↑/↓ และเปลี่ยน key ฟิลด์อย่างปลอดภัยพร้อมย้ายข้อมูลเดิม
- [x] Platform event bus: บันทึกเหตุการณ์ record/approval และฟีดเหตุการณ์ใน Settings
- [x] โมดูลบัญชี/การเงิน: ใบแจ้งหนี้, ใบเสร็จ/รับชำระ, ค่าใช้จ่าย พร้อม workflow และภาพรวมการเงินบน Dashboard
- [x] ธีม 3 สถานะ (ตามเครื่อง/สว่าง/มืด) พร้อมตามค่าของ OS แบบสด · หน้า “บัญชีของฉัน” (`/account`) ดูข้อมูล หน้าตา และสิทธิ์ของตัวเองได้ทุกบทบาท
- [x] คัดลอกรายการที่กรองแล้วเป็น TSV จากตาราง (ไว้แชร์ต่อ) และ modal เปลี่ยนเป็น bottom sheet บนมือถือ (ปัดลงเพื่อปิดได้)
- [x] เมนูผู้ใช้แบบสลับโมดูล (รายการโปรดก่อน, สูงสุด 5) และหน้า detail แยกแท็บข้อมูล/รายการที่เชื่อมโยง/ประวัติ พร้อมคำอธิบายใต้ฟิลด์
- [x] ท่าทางบนมือถือ: ปัดซ้าย/ขวาเปลี่ยนแท็บในหน้า detail, ปัดซ้ายปิดเมนู drawer
- [x] หน้า detail มีปุ่ม ‹ n/total › เดินตามลำดับรายการที่เพิ่งดู (ข้อมูลหลัก/เคส/โครงการ), Dashboard รีเฟรชตัวเองทุก 60 วิ + เวลาอัปเดต, popover บนมือถือพอดีจอ
- [x] Dashboard มีแถบ “โฟกัสวันนี้” (เคสเร่งด่วน/รออนุมัติ/PM เกินกำหนด/ใบแจ้งหนี้เกินกำหนด/ค่าใช้จ่ายรออนุมัติ/สินค้าใกล้หมด) พร้อมจุด live
- [x] คิวแจ้งเตือนอีเมล/LINE แบบ retry: เก็บใน DB, ลองซ้ำ 1·5·15·60·180 นาที (สูงสุด 5 ครั้ง), ดู/สั่งลองใหม่ได้ที่ Settings → แจ้งเตือน
- [x] โครงการเส้นทางราชการ: `track`, defended ICT (เกณฑ์ตั้งได้ใน Settings), MOU SJP–NT, วันสัญญา, ส่วนแบ่งรายได้ + gate บังคับก่อนจบขั้น 3/5 และการ์ดสรุปในหน้าโครงการ
- [x] เอกสารต่อขั้นแบบมีผู้ลงนาม (ชื่อ/บทบาท/วันที่/เวอร์ชัน), กำหนดเอกสารบังคับ/ต้องลงนามรายเอกสาร, แสดงรายการที่ขาด และบล็อกปุ่มจบขั้นจนครบ
- [x] หลังส่งมอบ: รายงานสัญญาบริการ (ใช้งาน/ใกล้หมด 60 วัน/หมดสัญญา) + ชิปบน Dashboard, ขั้น 14 “ถอด/เลิกติดตั้ง” และรายงานโครงการตามเส้นทาง/คู่สัญญา
- [x] Popover แจ้งเตือนและเมนูผู้ใช้ปิดทันทีเมื่อคลิกพื้นที่นอก (ไม่ต้องกดไอคอนซ้ำ)
- [x] รายงานส่วนแบ่งรายได้ (SJP/พาร์ตเนอร์) และรายงานบริการรายเดือน (เคสเปิด/ปิด/เวลาตอบสนอง/PM) เลือกเดือนได้
- [x] เส้นทาง R&D แยกไปป์ไลน์ของตัวเอง (8 ขั้น: Requirement Card → Prototype/POC → เอกสารสินค้า → Sign-off)
- [x] โต๊ะทำงาน: “จัดเรียงให้พอดี” เป็น row-grid 12 คอลัมน์ (gap 16px, สูง snap 8px, การ์ดแถวเดียวกันสูงเท่ากัน) และไม่ซ้อนทับ
- [x] โต๊ะทำงานหลาย Layer: เพิ่ม/ทำสำเนา/เปลี่ยนชื่อ/ลบ Layer, แม่แบบ ปฏิบัติการ/ผู้บริหาร/การเงิน และจัดวางแยกอิสระต่อ Layer (บันทึกฝั่งเซิร์ฟเวอร์)
- [x] ค้นหา Ctrl K: โฟกัสช่องค้นหาอัตโนมัติ, ↑/↓/PageUp/PageDown/Home/End ควบคุมรายการพร้อมเลื่อนตามไฮไลท์, ล็อกไม่ให้หน้าหลังเลื่อน
- [x] Ledger แบ่งรายได้ (REV): บันทึกรายงวด · คู่สัญญา · ยอดรับรู้ · ส่วน SJP/พาร์ตเนอร์ · สถานะจ่าย พร้อมเมนูในหมวดบัญชี
- [x] รายงาน PDF (A4 แนวนอน, หัวบริษัท/สรุป/วันที่พิมพ์): บริการรายเดือน · ส่วนแบ่งรายได้ · สัญญาบริการ พร้อมปุ่ม “พิมพ์ PDF”

ยังเป็นลำดับถัดไป (ตั้งใจไม่ทิ้ง core ERP):
- [x] PDF ฝั่งเซิร์ฟเวอร์จาก template HTML (รองรับภาษาไทย) + ปุ่มดาวน์โหลด PDF
- [x] แจ้งเตือนอีเมล SMTP / LINE Messaging API พร้อมหน้าตั้งค่าและทดสอบ
- [x] Backup/Restore รวมไฟล์แนบไบนารี (base64) และ event log
- [x] Webhook ภายนอกพร้อม HMAC signature, คิว retry อัตโนมัติ และประวัติการส่งใน Settings
- [x] Security hardening: JWT secret บังคับใน production, rate limit login, แยกสิทธิ์ users/roles, กรอง event/audit ตาม scope, file ACL, Webhook SSRF guard, security headers
- [x] Data integrity: ตรวจยอดใบแจ้งหนี้/รับชำระ, กันรับสินค้าเกิน PO, บังคับสิทธิ์ close ตอน reopen, Backup ต้องมี admin และเขียนไฟล์ก่อนลบของเดิม
- [x] Global search ใน Ctrl K ค้นหา record จริงตามสิทธิ์/scope (เลขเอกสาร ชื่อ ลูกค้า สินค้า ฯลฯ)
- [x] ตั้งค่าข้อมูลบริษัท/หัวเอกสาร และใช้บนหัว-ท้าย PDF ทุกประเภท
- [x] การ์ด “รายการที่เชื่อมโยง” ในหน้าเอกสาร (เช่น ลูกค้า → ใบแจ้งหนี้, ใบแจ้งหนี้ → ใบเสร็จ)
- [x] ปรับ text wrapping / overflow: ชื่อ/อีเมล/URL ยาวตัดบรรทัดได้, รายการยาวแสดง 2 บรรทัด, แท็บ wrap บนมือถือ ไม่มี horizontal overflow
- [x] UI resilience: safe-area/notch, modal เลื่อนได้เมื่อคีย์บอร์ดเปิด, StateComponent สำหรับ loading/empty/error, รูปภาพ object-fit และ guard ค่า null/undefined/[object Object]

ยังเป็นลำดับถัดไป (ตั้งใจไม่ทิ้ง core ERP):
- [ ] LINE Notify แบบเก่า และ retry queue สำหรับอีเมล/LINE
- [ ] เครื่องมือออกแบบ template PDF และตั้งเวลาส่งรายงาน
- [ ] พรีวิวรูปแนบ/thumbnail และ Backup แบบ streaming ไป S3
- [ ] Saved View แบบแชร์กับทีม (เก็บฝั่งเซิร์ฟเวอร์), ตัวสร้างเงื่อนไข AND/OR, จัดกลุ่มและยอดรวมทั้งชุด, ปรับความกว้าง/ย้ายคอลัมน์
- [ ] Workspace หลายองค์กร, วงจรร่าง–เผยแพร่–เก็บถาวรของโมดูล, และทดสอบภาระ 100,000 รายการ (ดูสถานะละเอียดที่ `docs/custom-erp-spec-status-2026-11-23.md`)
