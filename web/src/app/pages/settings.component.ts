import { ChangeDetectionStrategy, Component, OnInit, inject, signal } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { ApiService, apiErrorMessage } from '../core/api.service';
import { AuthService } from '../core/auth.service';
import { fmtDateTime } from '../core/util';
import { ModalComponent } from '../shared/modal.component';
import { ToastService } from '../shared/toast.service';
import { MetadataEditorComponent } from './metadata-editor.component';
import { WorkflowEditorComponent } from './workflow-editor.component';
import { RoleEditorComponent } from './role-editor.component';
import { BackupRestoreComponent } from './backup-restore.component';
import { EventsComponent } from './events.component';
import { NotifySettingsComponent } from './notify-settings.component';
import { CompanySettingsComponent } from './company-settings.component';
import { WebhooksComponent } from './webhooks.component';
import { WorkspaceSwitchService } from '../core/workspace-switch.service';
import type { RoleRow, SafeUser } from '../core/models';

type SettingsTab = 'users' | 'roles' | 'workspaces' | 'metadata' | 'workflow' | 'notify' | 'company' | 'webhooks' | 'backup' | 'events' | 'audit';

interface SettingsTabItem {
  key: SettingsTab;
  label: string;
  resource?: string;
}

interface SettingsTabGroup {
  label: string;
  items: SettingsTabItem[];
}

interface UserDraft {
  id?: string;
  username: string;
  name: string;
  roleId: string;
  dept: string;
  team: string;
  active: boolean;
  password: string;
  projectIds: string[];
  siteIds: string[];
}

interface WorkspaceAdmin {
  id: string;
  name: string;
  archived: boolean;
}

const isSettingsTab = (value: string): value is SettingsTab =>
  ['users', 'roles', 'workspaces', 'metadata', 'workflow', 'notify', 'company', 'webhooks', 'backup', 'events', 'audit'].includes(value);

@Component({
  selector: 'app-settings',
  standalone: true,
  imports: [ModalComponent, MetadataEditorComponent, WorkflowEditorComponent, RoleEditorComponent, BackupRestoreComponent, EventsComponent, NotifySettingsComponent, CompanySettingsComponent, WebhooksComponent],
  template: `
    <div class="page">
      <div class="page-head"><div><h1>ตั้งค่าผู้ใช้และสิทธิ์</h1><div class="muted">จัดการบัญชี บทบาท และประวัติการใช้งาน</div></div></div>
      @if (!auth.can('settings','view')) {
        <div class="state error">ไม่มีสิทธิ์เข้าถึงการตั้งค่า</div>
      } @else {
        <div class="settings-shell">
          <aside class="settings-nav" aria-label="หมวดการตั้งค่า">
            @for (group of tabGroups; track group.label) {
              <div class="settings-nav-group">
                <div class="settings-nav-title">{{ group.label }}</div>
                @for (item of group.items; track item.key) {
                  @if (!item.resource || auth.can(item.resource, 'view')) {
                    <button type="button" class="settings-nav-item" [class.active]="tab() === item.key" (click)="tab.set(item.key)">
                      {{ item.label }}
                    </button>
                  }
                }
              </div>
            }
          </aside>
          <div class="settings-main">
            @if (tab() === 'users' && auth.can('users','view')) {
        <div class="card">
          @if (auth.can('users','create')) { <button type="button" class="btn primary" style="margin-bottom:10px" (click)="openNew()">+ เพิ่มผู้ใช้</button> }
          @if (usersError()) {
            <div class="notice bad" role="alert">{{ usersError() }} <button type="button" class="btn sm" (click)="load()">ลองใหม่</button></div>
          }
          <div class="table-wrap"><table class="tbl"><thead><tr><th scope="col">ชื่อผู้ใช้</th><th scope="col">ชื่อ-สกุล</th><th scope="col">บทบาท</th><th scope="col">แผนก</th><th scope="col">ทีม</th><th scope="col">สถานะ</th></tr></thead>
            <tbody>@for (user of users(); track user.id) {
              <tr class="click" [attr.tabindex]="auth.can('users','edit') ? 0 : null" (click)="auth.can('users','edit') && openEdit(user)" (keydown)="openUserFromKeyboard($event, user)">
                <td data-label="ชื่อผู้ใช้">{{ user.username }}</td><td data-label="ชื่อ-สกุล">{{ user.name }}</td><td data-label="บทบาท">{{ user.roleName }}</td><td data-label="แผนก">{{ user.dept }}</td><td data-label="ทีม">{{ user.team }}</td><td data-label="สถานะ"><span class="badge {{ user.active ? 'green' : 'gray' }}">{{ user.active ? 'ใช้งาน' : 'ปิด' }}</span></td>
              </tr>
            }</tbody>
          </table></div>
        </div>
      }

      @if (tab() === 'workspaces' && auth.can('settings','view')) {
        <div class="card">
          <div style="display:flex;gap:8px;align-items:center;margin-bottom:8px">
            <b>Workspace (องค์กร)</b>
            <span style="flex:1"></span>
            @if (auth.can('settings','edit')) { <button type="button" class="btn primary" (click)="openWorkspace()">+ สร้าง Workspace</button> }
          </div>
          <p class="muted small">ข้อมูลของแต่ละ Workspace แยกจากกัน (รายการ, มุมมองที่บันทึก, ประวัติ, ไฟล์) ส่วนโมดูล บทบาท และ Workflow ใช้ร่วมกันทุก Workspace</p>
          @if (workspaceError()) {
            <div class="notice bad" role="alert">{{ workspaceError() }} <button type="button" class="btn sm" (click)="loadWorkspaces()">ลองใหม่</button></div>
          }
          <div class="table-wrap"><table class="tbl">
            <thead><tr><th scope="col">Workspace</th><th scope="col">รหัส</th><th scope="col">สถานะ</th><th scope="col">จัดการ</th></tr></thead>
            <tbody>@for (workspace of workspaces(); track workspace.id) {
              <tr>
                <td data-label="Workspace"><b>{{ workspace.name }}</b>@if (workspace.id === workspacesActive()) { <span class="badge green">กำลังใช้งาน</span> }</td>
                <td data-label="รหัส">{{ workspace.id }}</td>
                <td data-label="สถานะ"><span class="badge {{ workspace.archived ? 'gray' : 'green' }}">{{ workspace.archived ? 'เก็บถาวร' : 'ใช้งาน' }}</span></td>
                <td data-label="จัดการ">
                  <button type="button" class="btn sm" [disabled]="workspace.archived || workspace.id === workspacesActive()" (click)="switchWorkspace(workspace.id)">สลับมาใช้</button>
                  <button type="button" class="btn sm" (click)="openMembers(workspace)">สมาชิก</button>
                  @if (auth.can('settings','edit') && workspace.id !== 'default') {
                    <button type="button" class="btn sm" [disabled]="workspaceBusy()" (click)="toggleArchive(workspace)">{{ workspace.archived ? 'คืนสถานะ' : 'เก็บถาวร' }}</button>
                  }
                </td>
              </tr>
            }</tbody>
          </table></div>
        </div>
      }

      @if (tab() === 'roles' && auth.can('roles','view')) {
        <app-role-editor />
      }

      @if (tab() === 'metadata' && auth.can('settings','view')) {
        <app-metadata-editor [startCreating]="startCreating" />
      }

      @if (tab() === 'workflow' && auth.can('settings','view')) {
        <app-workflow-editor />
      }

      @if (tab() === 'backup' && auth.can('settings','view')) {
        <app-backup-restore />
      }

      @if (tab() === 'events' && auth.can('settings','view')) {
        <app-events />
      }

      @if (tab() === 'notify' && auth.can('settings','view')) {
        <app-notify-settings />
      }

      @if (tab() === 'company' && auth.can('settings','view')) {
        <app-company-settings />
      }

      @if (tab() === 'webhooks' && auth.can('settings','view')) {
        <app-webhooks />
      }

      @if (tab() === 'audit' && auth.can('settings','view')) {
        <div class="card">
          @if (!audit().length) { <div class="state empty">ยังไม่มีประวัติ</div> }
          @else { @for (entry of audit(); track entry['id']) { <div class="tl-item"><div class="tl-dot"></div><div><b>{{ entry['summary'] }}</b><div class="muted small">{{ entry['userName'] }} · {{ fmtDateTime(entry['at']) }}</div></div></div> } }
        </div>
            }
          </div>
        </div>
      }
    </div>

    @if (userOpen()) {
      <app-modal [title]="draft()?.id ? 'แก้ไขผู้ใช้' : 'เพิ่มผู้ใช้'" (closed)="userOpen.set(false)">
        @if (userError()) { <div class="notice bad" role="alert">{{ userError() }}</div> }
        <div class="form-grid">
          <div class="field"><label for="lf-settings-component-1">ชื่อผู้ใช้ *</label><input id="lf-settings-component-1" [value]="draft()!.username" (input)="setDraft('username', $any($event.target).value)" /></div>
          <div class="field"><label for="lf-settings-component-2">ชื่อ-สกุล *</label><input id="lf-settings-component-2" [value]="draft()!.name" (input)="setDraft('name', $any($event.target).value)" /></div>
          <div class="field"><label for="lf-settings-component-3">บทบาท</label><select id="lf-settings-component-3" [value]="draft()!.roleId" (change)="setDraft('roleId', $any($event.target).value)">@for (role of roles(); track role.id) { <option [value]="role.id" [selected]="role.id === draft()!.roleId">{{ role.name }}</option> }</select></div>
          <div class="field"><label for="lf-settings-component-4">{{ draft()!.id ? 'ตั้งรหัสผ่านใหม่ (เว้นว่างถ้าไม่เปลี่ยน)' : 'รหัสผ่าน * (อย่างน้อย 8 ตัว)' }}</label><input id="lf-settings-component-4" type="password" autocomplete="new-password" [value]="draft()!.password" (input)="setDraft('password', $any($event.target).value)" /></div>
          <div class="field"><label for="lf-settings-component-5">แผนก</label><input id="lf-settings-component-5" [value]="draft()!.dept" (input)="setDraft('dept', $any($event.target).value)" /></div>
          <div class="field"><label for="lf-settings-component-6">ทีม</label><input id="lf-settings-component-6" [value]="draft()!.team" (input)="setDraft('team', $any($event.target).value)" /></div>
          <label class="check"><input type="checkbox" [checked]="draft()!.active" (change)="setDraft('active', $any($event.target).checked)" /> เปิดใช้งานบัญชี</label>
        </div>
        <div modal-footer>
          <button type="button" class="btn" (click)="userOpen.set(false)">ยกเลิก</button>
          <button type="button" class="btn primary" [disabled]="userBusy()" (click)="saveUser()">บันทึก</button>
        </div>
      </app-modal>
    }

    @if (workspaceOpen()) {
      <app-modal title="สร้าง Workspace" (closed)="workspaceOpen.set(false)">
        @if (workspaceError()) { <div class="notice bad" role="alert">{{ workspaceError() }}</div> }
        <div class="form-grid">
          <div class="field"><label for="ws-id">รหัส Workspace *</label><input id="ws-id" [value]="workspaceDraft().id" (input)="setWorkspaceDraft('id', $any($event.target).value)" placeholder="branch-2" /></div>
          <div class="field"><label for="ws-name">ชื่อที่แสดง *</label><input id="ws-name" [value]="workspaceDraft().name" (input)="setWorkspaceDraft('name', $any($event.target).value)" placeholder="สาขาที่ 2" /></div>
        </div>
        <p class="muted small">รหัสใช้ a-z 0-9 - ยาว 2–40 ตัว และแก้ไขภายหลังไม่ได้</p>
        <div modal-footer>
          <button type="button" class="btn" (click)="workspaceOpen.set(false)">ยกเลิก</button>
          <button type="button" class="btn primary" [disabled]="workspaceBusy()" (click)="createWorkspace()">สร้าง</button>
        </div>
      </app-modal>
    }

    @if (membersOpen()) {
      <app-modal [title]="'สมาชิก Workspace ' + (membersWorkspace()?.name ?? '')" (closed)="membersOpen.set(false)">
        @if (!users().length) { <div class="state empty">ไม่พบรายชื่อผู้ใช้ (ต้องมีสิทธิ์ดูผู้ใช้)</div> }
        @else {
          <div class="form-grid">
            @for (user of users(); track user.id) {
              <label class="check"><input type="checkbox" [checked]="memberIds().includes(user.id)" (change)="toggleMember(user.id, $any($event.target).checked)" /> {{ user.name }} <span class="muted small">({{ user.username }})</span></label>
            }
          </div>
          <p class="muted small">ผู้ดูแลระบบเข้าถึงได้ทุก Workspace เสมอ — รายชื่อนี้ใช้กับผู้ใช้ทั่วไป</p>
        }
        <div modal-footer>
          <button type="button" class="btn" (click)="membersOpen.set(false)">ปิด</button>
          <button type="button" class="btn primary" [disabled]="memberBusy() || !membersWorkspace()" (click)="saveMembers()">บันทึกสมาชิก</button>
        </div>
      </app-modal>
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SettingsComponent implements OnInit {
  readonly auth = inject(AuthService);
  private readonly api = inject(ApiService);
  private readonly toast = inject(ToastService);
  private readonly route = inject(ActivatedRoute);
  readonly startCreating = this.route.snapshot.queryParamMap.get('create') === '1' && this.auth.can('settings', 'edit');

  readonly tab = signal<SettingsTab>('users');
  readonly tabGroups: SettingsTabGroup[] = [
    {
      label: 'ผู้ใช้และสิทธิ์',
      items: [
        { key: 'users', label: 'ผู้ใช้', resource: 'users' },
        { key: 'roles', label: 'บทบาท/สิทธิ์', resource: 'roles' },
        { key: 'workspaces', label: 'Workspace (องค์กร)' },
      ],
    },
    {
      label: 'ปรับแต่งระบบ',
      items: [
        { key: 'metadata', label: 'โมดูลและฟิลด์' },
        { key: 'workflow', label: 'Workflow' },
        { key: 'notify', label: 'การแจ้งเตือน' },
        { key: 'company', label: 'ข้อมูลบริษัท' },
      ],
    },
    {
      label: 'การเชื่อมต่อและข้อมูล',
      items: [
        { key: 'webhooks', label: 'Webhook' },
        { key: 'backup', label: 'สำรอง/กู้คืน' },
        { key: 'events', label: 'เหตุการณ์' },
        { key: 'audit', label: 'ประวัติการใช้งาน' },
      ],
    },
  ];
  readonly users = signal<SafeUser[]>([]);
  readonly usersError = signal('');
  readonly roles = signal<RoleRow[]>([]);
  readonly audit = signal<Record<string, unknown>[]>([]);
  readonly userOpen = signal(false);
  readonly userBusy = signal(false);
  readonly userError = signal('');
  readonly draft = signal<UserDraft>(this.blank());
  readonly fmtDateTime = fmtDateTime;
  readonly workspaces = signal<WorkspaceAdmin[]>([]);
  readonly workspacesActive = signal('');
  readonly workspaceError = signal('');
  readonly workspaceBusy = signal(false);
  readonly workspaceOpen = signal(false);
  readonly workspaceDraft = signal({ id: '', name: '' });
  readonly membersOpen = signal(false);
  readonly membersWorkspace = signal<WorkspaceAdmin | null>(null);
  readonly memberIds = signal<string[]>([]);
  readonly memberBusy = signal(false);
  private readonly workspaceSwitch = inject(WorkspaceSwitchService);

  ngOnInit(): void {
    if (!this.auth.can('users','view')) {
      this.tab.set(this.auth.can('roles','view') ? 'roles' : 'metadata');
    }
    const requested = this.route.snapshot.queryParamMap.get('tab');
    if (requested && this.auth.can('settings', 'view') && isSettingsTab(requested)) {
      this.tab.set(requested);
    }
    this.load();
  }

  load(): void {
    if (!this.auth.can('settings', 'view')) return;
    if (this.auth.can('users','view')) {
      this.usersError.set('');
      this.api.get<SafeUser[]>('/users').subscribe({
        next: (users) => this.users.set(users),
        error: (error: unknown) => {
          const message = apiErrorMessage(error);
          this.usersError.set(message);
          this.toast.error(message);
        },
      });
    }
    if (this.auth.can('roles','view')) {
      this.api.get<RoleRow[]>('/roles').subscribe({ next: (roles) => this.roles.set(roles), error: () => this.roles.set([]) });
    }
    this.api.get<Record<string, unknown>[]>('/audit', { limit: 100 }).subscribe({ next: (audit) => this.audit.set(audit), error: () => this.audit.set([]) });
    this.loadWorkspaces();
  }

  loadWorkspaces(): void {
    if (!this.auth.can('settings', 'view')) return;
    this.workspaceError.set('');
    this.api.get<{ items: WorkspaceAdmin[]; active: string }>('/workspaces').subscribe({
      next: (result) => {
        this.workspaces.set(result.items);
        this.workspacesActive.set(result.active);
      },
      error: (error: unknown) => this.workspaceError.set(apiErrorMessage(error)),
    });
  }

  openWorkspace(): void {
    this.workspaceDraft.set({ id: '', name: '' });
    this.workspaceError.set('');
    this.workspaceOpen.set(true);
  }

  setWorkspaceDraft(key: 'id' | 'name', value: string): void {
    this.workspaceDraft.update((draft) => ({ ...draft, [key]: value }));
  }

  createWorkspace(): void {
    if (this.workspaceBusy()) return;
    const draft = this.workspaceDraft();
    if (!draft.id.trim() || !draft.name.trim()) {
      this.workspaceError.set('กรุณากรอกรหัสและชื่อ Workspace');
      return;
    }
    this.workspaceBusy.set(true);
    this.api.post<WorkspaceAdmin>('/workspaces', { id: draft.id.trim(), name: draft.name.trim() }).subscribe({
      next: (created) => {
        this.workspaceBusy.set(false);
        this.workspaceOpen.set(false);
        this.loadWorkspaces();
        this.workspaceSwitch.load();
        this.toast.show(`สร้าง Workspace “${created.name}” แล้ว`);
      },
      error: (error: unknown) => {
        this.workspaceBusy.set(false);
        this.workspaceError.set(apiErrorMessage(error));
      },
    });
  }

  toggleArchive(workspace: WorkspaceAdmin): void {
    if (this.workspaceBusy()) return;
    this.workspaceBusy.set(true);
    this.api.put<WorkspaceAdmin>(`/workspaces/${workspace.id}`, { archived: !workspace.archived }).subscribe({
      next: () => {
        this.workspaceBusy.set(false);
        this.loadWorkspaces();
        this.workspaceSwitch.load();
        this.toast.show(workspace.archived ? 'คืนสถานะ Workspace แล้ว' : 'เก็บถาวร Workspace แล้ว');
      },
      error: (error: unknown) => {
        this.workspaceBusy.set(false);
        this.workspaceError.set(apiErrorMessage(error));
      },
    });
  }

  switchWorkspace(id: string): void {
    this.workspaceSwitch.switchTo(id);
    this.loadWorkspaces();
  }

  openMembers(workspace: WorkspaceAdmin): void {
    this.membersWorkspace.set(workspace);
    this.memberIds.set([]);
    this.membersOpen.set(true);
    this.api.get<{ userIds: string[] }>(`/workspaces/${workspace.id}/members`).subscribe({
      next: (result) => this.memberIds.set(result.userIds),
      error: (error: unknown) => {
        this.membersOpen.set(false);
        this.toast.error(apiErrorMessage(error));
      },
    });
  }

  toggleMember(userId: string, checked: boolean): void {
    this.memberIds.update((ids) => (checked ? [...new Set([...ids, userId])] : ids.filter((id) => id !== userId)));
  }

  saveMembers(): void {
    const workspace = this.membersWorkspace();
    if (!workspace || this.memberBusy()) return;
    this.memberBusy.set(true);
    this.api.put<{ userIds: string[] }>(`/workspaces/${workspace.id}/members`, { userIds: this.memberIds() }).subscribe({
      next: (result) => {
        this.memberBusy.set(false);
        this.memberIds.set(result.userIds);
        this.membersOpen.set(false);
        this.toast.show(`บันทึกสมาชิก Workspace “${workspace.name}” แล้ว`);
      },
      error: (error: unknown) => {
        this.memberBusy.set(false);
        this.toast.error(apiErrorMessage(error));
      },
    });
  }

  openNew(): void {
    this.draft.set(this.blank());
    this.userError.set('');
    this.userOpen.set(true);
  }

  openUserFromKeyboard(event: KeyboardEvent, user: SafeUser): void {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    event.preventDefault();
    if (this.auth.can('users', 'edit')) this.openEdit(user);
  }

  openEdit(user: SafeUser): void {
    if (!this.auth.can('settings', 'edit')) return;
    this.draft.set({
      id: user.id,
      username: user.username,
      name: user.name,
      roleId: user.roleId,
      dept: user.dept,
      team: user.team,
      active: user.active,
      password: '',
      projectIds: user.projectIds ?? [],
      siteIds: user.siteIds ?? [],
    });
    this.userError.set('');
    this.userOpen.set(true);
  }

  setDraft<K extends keyof UserDraft>(key: K, value: UserDraft[K]): void {
    this.draft.update((draft) => ({ ...draft, [key]: value }));
  }

  saveUser(): void {
    if (this.userBusy()) return;
    const draft = this.draft();
    this.userBusy.set(true);
    this.userError.set('');
    const body: Record<string, unknown> = { ...draft };
    delete body['id'];
    if (!body['password']) delete body['password'];
    const request = draft.id
      ? this.api.patch<SafeUser>(`/users/${draft.id}`, body)
      : this.api.post<SafeUser>('/users', body);
    request.subscribe({
      next: () => {
        this.userBusy.set(false);
        this.userOpen.set(false);
        this.toast.show('บันทึกผู้ใช้แล้ว');
        this.load();
      },
      error: (error: unknown) => {
        this.userBusy.set(false);
        this.userError.set(apiErrorMessage(error));
      },
    });
  }

  private blank(): UserDraft {
    return {
      username: '',
      name: '',
      roleId: this.roles().find((role) => !role.isAdmin)?.id ?? this.roles()[0]?.id ?? 'helpdesk',
      dept: '',
      team: '',
      active: true,
      password: '',
      projectIds: [],
      siteIds: [],
    };
  }
}
