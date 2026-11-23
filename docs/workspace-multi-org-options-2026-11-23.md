# Workspace หลายองค์กร — ทางเลือกและผลกระทบ (รอเจ้าของตัดสิน)

วันที่ 23/11/2026 · เอกสารประกอบสเปก `CUSTOM_ERP_DESIGN_SPEC.md` §1
สถานะ: **เลือกแบบ A แล้ว (23/11/2026)** — shared schema + `workspace_id`; เริ่มimplement core แล้ว (ตาราง workspaces/membership, active workspace, scoping ข้อมูลหลัก, switcher). เอกสารนี้เก็บทางเลือกและเหตุผลไว้เป็นบันทึกการตัดสินใจ

## สิ่งที่สเปกต้องการขั้นต่ำ (เฉพาะที่ยังไม่มี)

- Workspace = ขอบเขตองค์กร มีตัวระบุถาวร, ชื่อ, สถานะใช้งาน/เก็บถาวร
- ผู้ใช้เห็นตัวสลับ Workspace เมื่อมีมากกว่าหนึ่งแห่ง; ค่าที่เลือกจำต่อผู้ใช้
- Launcher/Sidebar/ค้นหา/ลิงก์ตรง ตรวจสิทธิ์ตาม Workspace
- ข้อมูล แยกตาม Workspace ไม่ให้เห็นข้ามองค์กรเว้นแต่ได้รับสิทธิ์
- โมดูล (Dataset) และ Saved View ผูกกับ Workspace

## ทางเลือก

### A. Shared schema + `workspace_id` (แนะนำสำหรับ ERP นี้)
ทุกตารางข้อมูลเพิ่ม `workspace_id` (records, saved_views, audit, events, approvals, webhooks, notify_queue, files); `settings` เก็บ metadata แยกต่อ Workspace หรือใช้ key นำหน้า
- ข้อดี: ใช้ฐานข้อมูล/โค้ดเดิม, query เดียว, เพิ่ม Workspace ได้ทันที, backfill ง่าย (ทุกแถวเดิม = workspace `default`)
- ข้อเสีย: ต้องเติมเงื่อนไข `workspace_id` ทุก query และมีโอกาสลืม (ต้องมี guard กลาง + test); isolation ระดับแอป ไม่ใช่ระดับ infra
- งานหลัก: migration + backfill, scope ทุก repository/list/search/related/options, สิทธิ์ราย Workspace (membership), ตัวสลับ + จำค่าต่อผู้ใช้, module/saved view scoping, รายงาน/แดชบอร์ดกรองตาม Workspace, backup/restore ต่อ Workspace

### B. หนึ่งไฟล์ฐานข้อมูลต่อ Workspace
แยก SQLite file (หรือ schema) ต่อองค์กร แล้วเลือก connection ตาม active workspace
- ข้อดี: isolation แข็งแรง, ลืมกรองแล้วไม่รั่วข้ามองค์กร
- ข้อเสีย: ต้องเปลี่ยนสถาปัตยกรรม DB/connection, migration หลายไฟล์, รายงานข้ามองค์กรทำยาก, backup/restore/ผู้ใช้กลางซับซ้อน, งานใหญ่กว่าอย่างมีนัยสำคัญ

### C. Deploy แยกต่อองค์กร (แยก instance)
แต่ละองค์กรมีระบบ/ฐานข้อมูลของตัวเอง
- ข้อดี: isolation สูงสุด, ง่ายต่อ compliance
- ข้อเสีย: ไม่มีตัวสลับ Workspace ในแอปเดียว, ดูแลหลาย instance, ไม่ตอบโจทย์ "สลับ Workspace" โดยตรง

## คำถามที่ต้องตัดสินก่อนเริ่ม

1. **รูปแบบแยกข้อมูล:** A / B / C (ผลต่างงาน ~1–2 สัปดาห์ vs หลายสัปดาห์)
2. **ผู้ใช้หนึ่งคนอยู่ได้หลาย Workspace หรือไม่** และบทบาท/สิทธิ์แยกต่อ Workspace หรือใช้ร่วมกัน
3. **โมดูล (Dataset) ใช้ร่วมทุก Workspace หรือแยก定義ต่อ Workspace**
4. **ข้อมูลเดิมทั้งหมด** ถูก assign เข้า Workspace เริ่มต้นชื่ออะไร (แนะนำ `default` / "องค์กรหลัก")
5. **รายงาน/แดชบอร์ด** ต้องรวมข้าม Workspace ได้หรือไม่ (ถ้าใช้ A ทำได้, B ยาก)

## ผลกระทบถ้าเลือก A (ขอบเขตงานโดยประมาณ)

| ส่วน | งาน |
|---|---|
| DB | ตาราง `workspaces`, คอลัมน์ `workspace_id` + index ทุกตารางข้อมูล, backfill |
| Auth | membership (user ↔ workspace, บทบาทต่อ workspace), active workspace ต่อผู้ใช้ |
| Records | บังคับเงื่อนไข workspace ในทุก read/write/search/aggregate, กันแก้ `workspace_id` |
| Meta | โมดูล/ฟิลด์/Workflow/Saved View ผูก workspace (หรือแชร์ตามข้อ 3) |
| UI | Workspace switcher ใน Global bar, จำค่า, เปลี่ยนแล้ว reload meta + กลับหน้าแรกของ workspace |
| Ops | backup/restore, webhook, notify queue, event/audit แยก workspace |
| Tests | e2e: ผู้ใช้ workspace A เปิดลิงก์ข้อมูล workspace B ไม่ได้; สลับ workspace แล้วเห็นชุดข้อมูลต่างกัน; ข้อมูลเดิมอยู่ workspace เริ่มต้น |

## ระหว่างรอคำตอบ

ระบบปัจจุบันทำงานแบบองค์กรเดียวโดยสมบูรณ์ (Workspace = ทั้งระบบ) และทุกฟีเจอร์อื่นของสเปกที่ทำแล้วไม่ต้องรื้อเมื่อเลือก A หรือ C; ถ้าเลือก B จะต้องปรับชั้น data access เพิ่ม
