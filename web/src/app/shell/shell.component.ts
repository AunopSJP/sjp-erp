import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  HostListener,
  OnDestroy,
  OnInit,
  QueryList,
  ViewChild,
  ViewChildren,
  computed,
  effect,
  inject,
  signal,
} from '@angular/core';
import { NavigationEnd, Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { filter } from 'rxjs';
import { ApiService } from '../core/api.service';
import { AuthService } from '../core/auth.service';
import { MetaService } from '../core/meta.service';
import { ThemeService } from '../core/theme.service';
import { horizontalSwipe } from '../core/util';
import { ToastService } from '../shared/toast.service';
import { IconComponent } from '../shared/icon.component';
import {
  readNavClosedGroups,
  readNavFavorites,
  readNavRecent,
  readSidebarCollapsed,
  writeNavClosedGroups,
  writeNavFavorites,
  writeNavRecent,
  writeSidebarCollapsed,
} from '../core/storage';
import type { ThemePref } from '../core/storage';
import type { SideNavGroup, SideNavItem } from './side-nav.component';
import { SideNavComponent } from './side-nav.component';
import type { QuickCreateAction } from './quick-create.component';
import { QuickCreateComponent } from './quick-create.component';
import type { LauncherContext } from '../pages/app-launcher.component';
import { WorkspaceSwitchService } from '../core/workspace-switch.service';

type NavItem = SideNavItem;
type NavGroup = SideNavGroup;

interface NotificationItem {
  id: string;
  type: string;
  tone: 'red' | 'amber' | 'blue';
  title: string;
  subtitle: string;
  link: string;
}

interface SearchResult {
  entity: string;
  entityLabel: string;
  id: string;
  code: string;
  title: string;
  subtitle: string;
  link: string;
}

interface PaletteItem {
  key: string;
  path: string;
  label: string;
  group: string;
  icon: string;
  kind: 'nav' | 'record';
  subtitle?: string;
}

const ENTITY_ICONS: Record<string, string> = {
  tickets: 'ticket',
  purchaseOrders: 'receipt',
  projects: 'folder',
  pmRecords: 'wrench',
  invoices: 'doc',
  receipts: 'receipt',
  expenses: 'chart',
  customers: 'building',
  vendors: 'truck',
  items: 'chip',
  serials: 'tag',
  vehicles: 'truck',
  vehicleBookings: 'calendar',
};

const GROUPS: NavGroup[] = [
  {
    label: 'ภาพรวม',
    icon: 'home',
    items: [
      { path: '/', label: 'หน้าแรก', short: 'หน้าแรก', icon: 'home' },
      { path: '/workspace', label: 'โต๊ะทำงาน', short: 'โต๊ะทำงาน', icon: 'grid' },
      { path: '/my', label: 'งานของฉัน', icon: 'check' },
      { path: '/calendar', label: 'ปฏิทินงาน', short: 'ปฏิทิน', icon: 'calendar' },
      { path: '/approvals', label: 'คำขออนุมัติ', icon: 'bell' },
    ],
  },
  {
    label: 'งานบริการและโครงการ',
    icon: 'wrench',
    items: [
      { path: '/tickets', label: 'แจ้งซ่อม', short: 'แจ้งซ่อม', icon: 'ticket', resource: 'tickets' },
      { path: '/pm', label: 'งาน PM', icon: 'wrench', resource: 'pm' },
      { path: '/projects', label: 'โครงการ', short: 'โครงการ', icon: 'folder', resource: 'projects' },
    ],
  },
  {
    label: 'ยานพาหนะ',
    icon: 'truck',
    items: [
      { path: '/vehicles', label: 'จองรถ', short: 'จองรถ', icon: 'calendar', resource: 'vehicleBookings' },
      { path: '/entities/vehicles', label: 'รถบริษัท', icon: 'truck', resource: 'vehicles' },
    ],
  },
  {
    label: 'จัดซื้อและคลัง',
    icon: 'box',
    items: [
      { path: '/purchase-orders', label: 'ใบสั่งซื้อ', icon: 'receipt', resource: 'purchase' },
      { path: '/warehouse', label: 'คลังสินค้า', short: 'คลัง', icon: 'box', resource: 'warehouse' },
    ],
  },
  {
    label: 'บัญชีและการเงิน',
    icon: 'receipt',
    items: [
      { path: '/entities/invoices', label: 'ใบแจ้งหนี้/วางบิล', icon: 'doc', resource: 'accounting' },
      { path: '/entities/receipts', label: 'ใบเสร็จ/รับชำระ', icon: 'receipt', resource: 'accounting' },
      { path: '/entities/expenses', label: 'ค่าใช้จ่าย', icon: 'chart', resource: 'accounting' },
      { path: '/entities/revenueShares', label: 'แบ่งรายได้', icon: 'chart', resource: 'accounting' },
    ],
  },
  {
    label: 'ข้อมูลหลัก',
    icon: 'building',
    items: [
      { path: '/entities/customers', label: 'ลูกค้า', icon: 'building', resource: 'master' },
      { path: '/entities/vendors', label: 'ผู้ขาย', icon: 'truck', resource: 'master' },
      { path: '/entities/contacts', label: 'ผู้ติดต่อ', icon: 'user', resource: 'master' },
      { path: '/entities/sites', label: 'ไซต์งาน', icon: 'pin', resource: 'master' },
      { path: '/entities/items', label: 'สินค้า/อุปกรณ์', icon: 'chip', resource: 'assets' },
      { path: '/entities/serials', label: 'Serial Number', icon: 'tag', resource: 'assets' },
    ],
  },
  {
    label: 'ระบบ',
    icon: 'gear',
    items: [
      { path: '/reports', label: 'รายงานและส่งออก', icon: 'chart', resource: 'reports' },
      { path: '/settings', label: 'ตั้งค่า', short: 'ตั้งค่า', icon: 'gear', resource: 'settings' },
    ],
  },
];

const QUICK_ACTIONS: QuickCreateAction[] = [
  { label: 'แจ้งซ่อม', path: '/tickets/new', icon: 'ticket', resource: 'tickets' },
  { label: 'ใบสั่งซื้อ', path: '/purchase-orders?new=1', icon: 'receipt', resource: 'purchase' },
  { label: 'ใบแจ้งหนี้', path: '/entities/invoices?new=1', icon: 'doc', resource: 'accounting' },
  { label: 'รับชำระ', path: '/entities/receipts?new=1', icon: 'receipt', resource: 'accounting' },
  { label: 'ค่าใช้จ่าย', path: '/entities/expenses?new=1', icon: 'chart', resource: 'accounting' },
  { label: 'โครงการ', path: '/projects?new=1', icon: 'folder', resource: 'projects' },
  { label: 'จองรถ', path: '/vehicles?new=1', icon: 'calendar', resource: 'vehicleBookings' },
];

const DEFAULT_FAVORITES: string[] = [];
const MAX_FAVORITES = 6;
const APP_ALIASES: Record<string, string> = {
  '/': 'Dashboard Home', '/workspace': 'Workspace', '/my': 'My work', '/calendar': 'Calendar',
  '/approvals': 'Approvals', '/tickets': 'Service Tickets', '/pm': 'Preventive Maintenance',
  '/projects': 'Projects', '/vehicles': 'Vehicle booking', '/entities/vehicles': 'Fleet',
  '/purchase-orders': 'Purchase Orders Procurement PO', '/warehouse': 'Warehouse Inventory',
  '/entities/invoices': 'Invoices', '/entities/receipts': 'Receipts Payments', '/entities/expenses': 'Expenses',
  '/entities/revenueShares': 'Revenue sharing', '/entities/customers': 'Customers',
  '/entities/vendors': 'Vendors Suppliers', '/entities/contacts': 'Contacts', '/entities/sites': 'Sites',
  '/entities/items': 'Items Assets', '/entities/serials': 'Serial Numbers', '/reports': 'Reports', '/settings': 'Settings',
};

/** Pages reachable from the user menu rather than the sidebar. */
const EXTRA_PAGES: Record<string, { label: string; group: string }> = {
  '/account': { label: 'บัญชีของฉัน', group: 'ระบบ' },
  '/apps': { label: 'แอปทั้งหมด', group: 'SJP ERP' },
};

const normalizeUrl = (url: string): string => url.split('?')[0].split('#')[0];

const matchesPath = (url: string, path: string): boolean => {
  const clean = normalizeUrl(url);
  if (path === '/') return clean === '/';
  return clean === path || clean.startsWith(`${path}/`);
};

@Component({
  selector: 'app-shell',
  standalone: true,
  imports: [RouterOutlet, RouterLink, RouterLinkActive, IconComponent, SideNavComponent, QuickCreateComponent],
  template: `
    <div class="app">
      <a class="skip-link" href="#main-content">ข้ามไปยังเนื้อหาหลัก</a>
      <app-side-nav
        class="sb-desktop"
        [mode]="sidebarCollapsed() ? 'rail' : 'expanded'"
        [groups]="sidebarGroups()"
        [catalog]="allItems()"
        [favorites]="favorites()"
        [closedGroups]="navClosed()"
        [currentUrl]="currentUrl()"
        [pendingApprovals]="pendingApprovals()"
        [theme]="theme()"
        (toggleFavorite)="toggleFavorite($event)"
        (reorderFavorites)="reorderFavorites($event)"
        (toggleGroup)="toggleGroup($event)"
        (toggleCollapse)="toggleSidebar()"
        (toggleTheme)="toggleTheme()"
      />

      <div class="main2">
        <header class="top">
          <button class="menu-chip" type="button" (click)="openMenu($event.currentTarget)" aria-label="เปิดเมนู">
            <app-icon name="menu" [size]="18" /> <span class="menu-chip-label">เมนู</span>
          </button>
          <div class="crumbs">
            <span class="muted">{{ pageInfo().group }}</span>
            <app-icon name="chevron" [size]="16" />
            <b>{{ pageInfo().label }}</b>
          </div>
          @if (workspaces.items().length > 1) {
            <label class="ws-switch">
              <span class="sr-only">Workspace ปัจจุบัน</span>
              <select [value]="workspaces.active()" [disabled]="workspaces.busy()" (change)="switchWorkspace($event)" aria-label="สลับ Workspace">
                @for (workspace of workspaces.items(); track workspace.id) {
                  <option [value]="workspace.id" [selected]="workspace.id === workspaces.active()">{{ workspace.name }}</option>
                }
              </select>
            </label>
          }
          <a class="icon-btn launcher-entry" routerLink="/apps" routerLinkActive="active" ariaCurrentWhenActive="page" aria-label="แอปทั้งหมด" title="แอปทั้งหมด">
            <app-icon name="grid" [size]="20" /><span>แอปทั้งหมด</span>
          </a>
          <span class="grow"></span>
          <button class="search-box" type="button" (click)="openPalette()" aria-keyshortcuts="Control+K">
            <app-icon name="search" [size]="18" aria-hidden="true" />
            <span>ค้นหาทั่วระบบ…</span>
            <kbd aria-hidden="true">Ctrl K</kbd>
          </button>
          @if (quickActions().length || quickPrimary()) {
            <app-quick-create
              [currentUrl]="currentUrl()"
              [actions]="quickActions()"
              [primaryOverride]="quickPrimary()"
            />
          }
          <div class="pop-wrap">
            <button class="icon-btn approval-btn" type="button" (click)="toggleNotifications()" [attr.aria-expanded]="notificationsOpen()" [attr.aria-label]="notifications().length ? 'การแจ้งเตือน ' + notifications().length + ' รายการ' : 'การแจ้งเตือน'">
              <app-icon name="bell" [size]="20" />
              @if (notifications().length) { <span class="bell-badge">{{ notifications().length > 99 ? '99+' : notifications().length }}</span> }
            </button>
            @if (notificationsOpen()) {
              <div class="popover right notif-pop">
                <div class="pop-title">การแจ้งเตือน <span class="badge {{ notifications().length ? 'red' : 'gray' }}">{{ notifications().length }}</span></div>
                @if (!notifications().length) {
                  <div class="state small">ไม่มีเรื่องที่ต้องดำเนินการ</div>
                } @else {
                  @for (item of notifications(); track item.id) {
                    <button type="button" class="pop-row notif-row" (click)="openNotification(item)">
                      <span class="badge {{ item.tone }}">{{ notificationLabel(item) }}</span>
                      <span class="notif-text"><b>{{ item.title }}</b><small>{{ item.subtitle }}</small></span>
                    </button>
                  }
                  <a class="pop-row" routerLink="/my" (click)="notificationsOpen.set(false)">ดูงานของฉันทั้งหมด</a>
                }
              </div>
            }
          </div>
          <div class="pop-wrap">
            <button class="user-btn" type="button" (click)="toggleUserMenu()" [attr.aria-expanded]="userOpen()">
              <span class="avatar">{{ initials() }}</span>
              <span class="user-name" [title]="auth.user()?.name">{{ auth.user()?.name }}</span>
            </button>
            @if (userOpen()) {
              <div class="popover right">
                <div class="pop-title">{{ auth.user()?.name }}<div class="muted small" style="font-weight:400">{{ auth.user()?.roleName }} · {{ auth.user()?.username }}</div></div>
                <a class="pop-row" routerLink="/account" (click)="userOpen.set(false)"><app-icon name="user" /> บัญชีของฉัน</a>
                @if (switcherItems().length) {
                  <div class="pop-seg-label" id="switch-seg-label">สลับไปที่ · {{ switcherItems().length }}</div>
                  <div class="app-switch" role="group" aria-labelledby="switch-seg-label">
                    @for (item of switcherItems(); track item.path) {
                      <a class="app-chip" [routerLink]="item.path" (click)="userOpen.set(false)">
                        <app-icon [name]="item.icon" [size]="16" /><span>{{ item.short || item.label }}</span>
                      </a>
                    }
                  </div>
                }
                <div class="pop-seg-label" id="theme-seg-label">ธีม</div>
                <div class="pop-seg" role="group" aria-labelledby="theme-seg-label">
                  @for (option of themeOptions; track option.value) {
                    <button
                      type="button"
                      class="seg-btn"
                      [class.on]="themePref() === option.value"
                      [attr.aria-pressed]="themePref() === option.value"
                      (click)="setThemePref(option.value)"
                    >{{ option.label }}</button>
                  }
                </div>
                <button class="pop-row" type="button" (click)="toggleDensity()"><app-icon name="columns" /> ความหนาแน่น: {{ density() === 'compact' ? 'กระชับ' : 'สบาย' }}</button>
                <button class="pop-row" type="button" (click)="auth.logout()"><app-icon name="logout" /> ออกจากระบบ</button>
              </div>
            }
          </div>
        </header>

        <main id="main-content" class="content" tabindex="-1"><router-outlet [routerOutletData]="launcherContext()" /></main>

        <nav class="bottombar" aria-label="ทางลัดด้านล่าง">
          @for (item of mobilePinned(); track item.path) {
            <a class="bb-item" [routerLink]="item.path" routerLinkActive="'active'" [routerLinkActiveOptions]="{ exact: item.path === '/' }">
              <span class="bb-ic"><app-icon [name]="item.icon" [size]="24" /></span><span>{{ item.short ?? item.label }}</span>
            </a>
          }
          <button class="bb-item" type="button" (click)="openMenu($event.currentTarget)"><span class="bb-ic"><app-icon name="menu" [size]="24" /></span><span>เมนู</span></button>
        </nav>
      </div>
    </div>

    @if (menuOpen()) {
      <div
        class="overlay sb-drawer-overlay"
        (mousedown)="onOverlay($event)"
        (pointerdown)="drawerSwipeStart($event)"
        (pointerup)="drawerSwipeEnd($event)"
        (pointercancel)="drawerSwipeCancel()"
      >
        <app-side-nav
          class="sb-drawer-host"
          mode="drawer"
          [groups]="sidebarGroups()"
          [catalog]="allItems()"
          [favorites]="favorites()"
          [closedGroups]="navClosed()"
          [currentUrl]="currentUrl()"
          [pendingApprovals]="pendingApprovals()"
          [theme]="theme()"
          (toggleFavorite)="toggleFavorite($event)"
          (reorderFavorites)="reorderFavorites($event)"
          (toggleGroup)="toggleGroup($event)"
          (toggleTheme)="toggleTheme()"
          (closeDrawer)="closeMenu()"
        />
      </div>
    }

    @if (paletteOpen()) {
      <div class="overlay palette-overlay" (mousedown)="onOverlay($event)">
        <div class="palette" role="dialog" aria-label="ค้นหา">
          <div class="palette-input">
            <app-icon name="search" />
            <input #paletteInput autofocus [value]="paletteQuery()" (input)="setPaletteQuery($any($event.target).value)" placeholder="ค้นหาเมนู เลขเอกสาร ลูกค้า สินค้า…" aria-label="ค้นหา" />
            <kbd>Esc</kbd>
          </div>
          <div class="palette-list">
            @if (!paletteResults().length) {
              <div class="state">ไม่พบเมนูหรือรายการที่ตรงกับ “{{ paletteQuery() }}”</div>
            } @else {
              @for (item of paletteResults(); track item.key; let i = $index) {
                <button type="button" class="palette-row" #paletteRow [class.on]="paletteIndex() === i" (mouseenter)="paletteIndex.set(i)" (click)="go(item)">
                  <app-icon [name]="item.icon" [size]="18" />
                  <span class="pl">{{ item.label }}</span>
                  <span class="muted small">{{ item.subtitle || item.group }}</span>
                </button>
              }
            }
          </div>
          <div class="palette-foot">
            <span><kbd>↑</kbd><kbd>↓</kbd> เลือก</span>
            <span><kbd>Enter</kbd> เปิด</span>
            <span><kbd>Esc</kbd> ปิด</span>
          </div>
        </div>
      </div>
    }
  `,
  styles: [`
    .launcher-entry { gap: 6px; flex: 0 0 auto; width: auto; min-width: 40px; padding-inline: 8px; }
    .launcher-entry.active { color: var(--pri); background: var(--pri-l); }
    .ws-switch select { max-width: 200px; }
    @media (max-width: 900px) { .ws-switch { display: none; } }
    @media (max-width: 1100px) { .launcher-entry span { display: none; } }
  `],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ShellComponent implements OnInit, OnDestroy {
  @ViewChild('paletteInput') private paletteInput?: ElementRef<HTMLInputElement>;
  @ViewChildren('paletteRow') private paletteRows?: QueryList<ElementRef<HTMLElement>>;

  readonly auth = inject(AuthService);
  private readonly meta = inject(MetaService);
  readonly workspaces = inject(WorkspaceSwitchService);
  private readonly themeService = inject(ThemeService);
  private readonly api = inject(ApiService);
  private readonly router = inject(Router);
  private readonly toast = inject(ToastService);

  readonly menuOpen = signal(false);
  readonly userOpen = signal(false);
  readonly paletteOpen = signal(false);
  readonly paletteQuery = signal('');
  readonly paletteIndex = signal(0);
  readonly recordResults = signal<SearchResult[]>([]);
  private searchTimer: ReturnType<typeof setTimeout> | null = null;
  readonly themePref = this.themeService.pref;
  readonly theme = this.themeService.theme;
  readonly density = this.themeService.density;
  readonly themeOptions: ReadonlyArray<{ value: ThemePref; label: string }> = [
    { value: 'system', label: 'ตามเครื่อง' },
    { value: 'light', label: 'สว่าง' },
    { value: 'dark', label: 'มืด' },
  ];
  readonly sidebarCollapsed = signal(readSidebarCollapsed());
  readonly currentUrl = signal(this.router.url);
  readonly pendingApprovals = signal(0);
  readonly notifications = signal<NotificationItem[]>([]);
  readonly notificationsOpen = signal(false);
  private drawerSwipeFrom: { x: number; y: number } | null = null;
  private drawerTrigger: HTMLElement | null = null;

  constructor() {
    effect(() => {
      document.body.classList.toggle('palette-open', this.paletteOpen());
    });
  }

  private readonly navUserId = this.auth.user()?.id;
  private readonly storedFavorites = signal<string[] | null>(readNavFavorites(this.navUserId));
  readonly closedGroups = signal<string[]>(readNavClosedGroups(this.navUserId) ?? []);
  private readonly recentPaths = signal(readNavRecent(this.navUserId));

  readonly visibleGroups = computed<NavGroup[]>(() => {
    const groups: NavGroup[] = GROUPS.map((group) => ({
      ...group,
      items: group.items.filter((item) => !item.resource || this.auth.can(item.resource, 'view')),
    })).filter((group) => group.items.length);
    const custom = (this.meta.meta()?.customModules ?? [])
      .filter((entity) => entity.can?.['view']);
    const ungrouped: NavItem[] = [];
    for (const entity of custom) {
      const item: NavItem = {
        path: `/entities/${entity.key}`,
        label: entity.navLabel || entity.label,
        icon: entity.icon || 'puzzle',
        resource: entity.key,
        description: entity.description,
        alias: [entity.key, entity.label, entity.navLabel, ...(entity.aliases ?? [])].filter(Boolean).join(' '),
      };
      const target = entity.group ? groups.find((group) => group.label === entity.group) : undefined;
      if (target) target.items = [...target.items, item];
      else ungrouped.push(item);
    }
    return ungrouped.length ? [...groups, { label: 'โมดูลของฉัน', icon: 'puzzle', items: ungrouped }] : groups;
  });

  /** Every group the user may see; only the current one starts expanded so the rail stays short. */
  readonly sidebarGroups = computed(() => this.visibleGroups());

  private readonly activeGroupLabel = computed(() => {
    const url = this.currentUrl();
    const groups = this.visibleGroups();
    return (groups.find((group) => group.items.some((item) => matchesPath(url, item.path))) ?? groups[0])?.label ?? '';
  });
  private readonly openedGroups = signal<string[]>([]);
  readonly navClosed = computed(() => {
    const active = this.activeGroupLabel();
    return this.visibleGroups()
      .filter((group) => (group.label === active
        ? this.closedGroups().includes(group.label)
        : !this.openedGroups().includes(group.label)))
      .map((group) => group.label);
  });

  private readonly allNavItems = computed<NavItem[]>(() => this.visibleGroups().flatMap((group) => group.items));
  private readonly visiblePaths = computed(() => new Set(this.allNavItems().map((item) => item.path)));

  readonly favorites = computed<string[]>(() => {
    const visible = this.visiblePaths();
    const base = this.storedFavorites() ?? DEFAULT_FAVORITES;
    return base.filter((path) => visible.has(path)).slice(0, MAX_FAVORITES);
  });

  readonly mobilePinned = computed<NavItem[]>(() => {
    const items = this.allNavItems();
    const preferred = this.favorites().length ? this.favorites() : DEFAULT_FAVORITES;
    const picked = preferred
      .map((path) => items.find((item) => item.path === path))
      .filter((item): item is NavItem => !!item)
      .slice(0, 3);
    return picked.length ? picked : items.slice(0, 3);
  });

  /** Favourites first, otherwise one entry per module group — the user-menu switcher. */
  readonly switcherItems = computed<NavItem[]>(() => {
    const items = this.allNavItems();
    const favorites = this.favorites()
      .map((path) => items.find((item) => item.path === path))
      .filter((item): item is NavItem => !!item);
    if (favorites.length) return favorites.slice(0, 5);
    const groups = this.visibleGroups().filter((group) => group.label !== 'ภาพรวม' && group.label !== 'ระบบ');
    const picked: NavItem[] = [];
    for (const group of groups) {
      const item = group.items[0];
      if (item && !picked.some((existing) => existing.path === item.path)) picked.push(item);
    }
    return picked.slice(0, 5);
  });

  readonly quickActions = computed<QuickCreateAction[]>(() =>
    QUICK_ACTIONS.filter((action) => this.auth.can(action.resource ?? '', 'create')),
  );

  readonly quickPrimary = computed<QuickCreateAction | null>(() => {
    const url = normalizeUrl(this.currentUrl());
    const key = url.match(/^\/entities\/([^/]+)/)?.[1];
    if (!key || ['invoices', 'receipts', 'expenses'].includes(key)) return null;
    const def = this.meta.entity(key);
    if (!def || !this.auth.can(def.resource, 'create')) return null;
    const label = def.label.length + 5 > 16 ? 'เพิ่ม' : `เพิ่ม${def.label}`;
    return { label, path: `/entities/${key}?new=1`, icon: 'plus', resource: def.resource };
  });

  readonly allItems = computed<(NavItem & { group: string })[]>(() =>
    this.visibleGroups().flatMap((group) => group.items.map((item) => ({
      ...item, group: group.label, alias: item.alias ?? APP_ALIASES[item.path],
    }))),
  );

  readonly launcherContext = computed<LauncherContext>(() => ({
    items: this.allItems(),
    favorites: this.favorites(),
    recent: this.recentPaths(),
    loading: this.meta.loading(),
    failed: this.meta.failed(),
    canCreate: this.auth.can('settings', 'view') && this.auth.can('settings', 'edit'),
    retry: () => this.meta.load(true),
    toggleFavorite: (path) => this.toggleFavorite(path),
  }));

  readonly paletteResults = computed<PaletteItem[]>(() => {
    const query = this.paletteQuery().trim().toLowerCase();
    const nav: PaletteItem[] = (query
      ? this.allItems().filter((item) => `${item.label} ${item.group} ${item.alias ?? ''}`.toLowerCase().includes(query))
      : this.allItems()
    )
      .slice(0, 20)
      .map((item) => ({
        key: `nav:${item.path}`,
        path: item.path,
        label: item.label,
        group: item.group,
        icon: item.icon,
        kind: 'nav',
      }));
    const records: PaletteItem[] = this.recordResults().map((item) => ({
      key: `record:${item.entity}:${item.id}`,
      path: item.link,
      label: `${item.code} — ${item.title}`,
      group: item.entityLabel,
      icon: ENTITY_ICONS[item.entity] ?? 'doc',
      kind: 'record',
      subtitle: `${item.entityLabel} · ${item.code}`,
    }));
    return [...records, ...nav].slice(0, 25);
  });

  readonly pageInfo = computed(() => {
    const url = this.currentUrl().split('?')[0];
    const extra = EXTRA_PAGES[url];
    if (extra) return extra;
    const items = this.allItems();
    const hit = items
      .filter((item) => matchesPath(url, item.path))
      .sort((a, b) => b.path.length - a.path.length)[0];
    return hit ? { label: hit.label.length > 28 ? 'รายการ' : hit.label, group: hit.group } : { label: 'หน้า', group: 'SJP ERP' };
  });

  readonly initials = computed(() => (this.auth.user()?.name ?? '?').trim().charAt(0));

  ngOnInit(): void {
    this.meta.load(true);
    this.workspaces.load();
    this.loadApprovals();
    this.loadNotifications();
    this.router.events.pipe(filter((event) => event instanceof NavigationEnd)).subscribe((event) => {
      const url = (event as NavigationEnd).urlAfterRedirects;
      this.currentUrl.set(url);
      this.closeMenu(false);
      if (normalizeUrl(url) === '/apps') this.meta.load(true);
      const visited = this.allItems().find((item) => matchesPath(url, item.path));
      if (visited && visited.path !== '/') {
        const next = [visited.path, ...this.recentPaths().filter((path) => path !== visited.path)].slice(0, 8);
        this.recentPaths.set(next);
        writeNavRecent(next, this.navUserId);
      }
      this.userOpen.set(false);
      this.paletteOpen.set(false);
      this.paletteQuery.set('');
      this.recordResults.set([]);
      this.notificationsOpen.set(false);
      this.loadApprovals();
      this.loadNotifications();
      window.scrollTo(0, 0);
    });
    window.addEventListener('keydown', this.hotkey);
  }

  ngOnDestroy(): void {
    window.removeEventListener('keydown', this.hotkey);
    document.body.classList.remove('sb-lock');
    if (this.searchTimer) clearTimeout(this.searchTimer);
  }

  /** Explicit light/dark; the sidebar switch keeps its one-tap behaviour. */
  switchWorkspace(event: Event): void {
    if (event.target instanceof HTMLSelectElement) this.workspaces.switchTo(event.target.value);
  }

  toggleTheme(): void {
    this.themeService.toggle();
  }

  setThemePref(pref: ThemePref): void {
    this.themeService.setPref(pref);
  }

  toggleDensity(): void {
    this.themeService.toggleDensity();
  }

  toggleSidebar(): void {
    const next = !this.sidebarCollapsed();
    this.sidebarCollapsed.set(next);
    writeSidebarCollapsed(next);
  }

  openMenu(trigger?: EventTarget | null): void {
    this.drawerTrigger = trigger instanceof HTMLElement ? trigger : null;
    this.menuOpen.set(true);
    document.body.classList.add('sb-lock');
  }

  closeMenu(restoreFocus = true): void {
    this.menuOpen.set(false);
    document.body.classList.remove('sb-lock');
    if (restoreFocus) this.drawerTrigger?.focus();
    this.drawerTrigger = null;
  }

  /** Swipe the drawer to the left to dismiss it (touch only). */
  drawerSwipeStart(event: PointerEvent): void {
    if (event.pointerType === 'mouse') return;
    this.drawerSwipeFrom = { x: event.clientX, y: event.clientY };
  }

  drawerSwipeEnd(event: PointerEvent): void {
    const from = this.drawerSwipeFrom;
    this.drawerSwipeFrom = null;
    if (!from) return;
    if (horizontalSwipe(event.clientX - from.x, event.clientY - from.y) === 'left') this.closeMenu();
  }

  drawerSwipeCancel(): void {
    this.drawerSwipeFrom = null;
  }

  toggleFavorite(path: string): void {
    if (!this.visiblePaths().has(path)) return;
    const current = this.favorites();
    if (!current.includes(path) && current.length >= MAX_FAVORITES) {
      this.toast.error(`ปักหมุดได้สูงสุด ${MAX_FAVORITES} รายการ`);
      return;
    }
    const next = current.includes(path) ? current.filter((item) => item !== path) : [...current, path];
    this.storedFavorites.set(next);
    writeNavFavorites(next, this.navUserId);
  }

  reorderFavorites(paths: string[]): void {
    const visible = new Set(this.favorites());
    const next = paths.filter((path) => visible.has(path)).slice(0, MAX_FAVORITES);
    this.storedFavorites.set(next);
    writeNavFavorites(next, this.navUserId);
  }

  toggleGroup(label: string): void {
    if (label !== this.activeGroupLabel()) {
      this.openedGroups.update((list) => (list.includes(label) ? list.filter((item) => item !== label) : [...list, label]));
      return;
    }
    const current = this.closedGroups();
    const next = current.includes(label)
      ? current.filter((item) => item !== label)
      : [...current, label];
    this.closedGroups.set(next);
    writeNavClosedGroups(next, this.navUserId);
  }

  private loadApprovals(): void {
    this.api.get<{ pending: unknown[] }>('/approvals').subscribe({
      next: (result) => this.pendingApprovals.set(result.pending?.length ?? 0),
      error: () => this.pendingApprovals.set(0),
    });
  }

  private loadNotifications(): void {
    this.api.get<{ items: NotificationItem[] }>('/notifications').subscribe({
      next: (result) => this.notifications.set(result.items ?? []),
      error: () => this.notifications.set([]),
    });
  }

  toggleNotifications(): void {
    const next = !this.notificationsOpen();
    this.notificationsOpen.set(next);
    this.userOpen.set(false);
    if (next) this.loadNotifications();
  }

  toggleUserMenu(): void {
    const next = !this.userOpen();
    this.userOpen.set(next);
    this.notificationsOpen.set(false);
  }

  /** Clicking anywhere outside the popover wrappers dismisses both panels. */
  @HostListener('document:pointerdown', ['$event'])
  onDocumentPointer(event: PointerEvent): void {
    if (!this.notificationsOpen() && !this.userOpen()) return;
    const target = event.target as HTMLElement | null;
    if (target?.closest('.pop-wrap')) return;
    this.notificationsOpen.set(false);
    this.userOpen.set(false);
  }

  openNotification(item: NotificationItem): void {
    this.notificationsOpen.set(false);
    void this.router.navigateByUrl(item.link);
  }

  notificationLabel(item: NotificationItem): string {
    if (item.type === 'approval') return 'อนุมัติ';
    if (item.type === 'vehicle') return 'จองรถ';
    if (item.tone === 'red') return 'เร่ง';
    return 'เตือน';
  }

  openPalette(): void {
    this.paletteQuery.set('');
    this.paletteIndex.set(0);
    this.recordResults.set([]);
    this.paletteOpen.set(true);
    // The overlay is created after this call and `autofocus` is unreliable for
    // dynamically inserted nodes, so move focus explicitly.
    setTimeout(() => {
      const input = this.paletteInput?.nativeElement;
      if (!input) return;
      input.focus();
      input.select();
      this.revealPalette();
    }, 0);
  }

  movePalette(delta: number): void {
    const count = this.paletteResults().length;
    if (!count) return;
    this.paletteIndex.update((index) => Math.max(0, Math.min(count - 1, index + delta)));
    this.revealPalette();
  }

  setPaletteIndex(index: number): void {
    const count = this.paletteResults().length;
    if (!count) return;
    this.paletteIndex.set(Math.max(0, Math.min(count - 1, index)));
    this.revealPalette();
  }

  /** Keeps the highlighted row inside the scrollable list. */
  private revealPalette(): void {
    const index = this.paletteIndex();
    requestAnimationFrame(() => {
      const row = this.paletteRows?.get(index)?.nativeElement;
      row?.scrollIntoView({ block: 'nearest' });
    });
  }

  go(item: PaletteItem): void {
    this.paletteOpen.set(false);
    this.paletteQuery.set('');
    this.paletteIndex.set(0);
    this.recordResults.set([]);
    void this.router.navigateByUrl(item.path);
  }

  setPaletteQuery(value: string): void {
    this.paletteQuery.set(value);
    this.paletteIndex.set(0);
    this.revealPalette();
    if (this.searchTimer) clearTimeout(this.searchTimer);
    const query = value.trim();
    if (query.length < 2) {
      this.recordResults.set([]);
      return;
    }
    this.searchTimer = setTimeout(() => {
      this.api.get<{ results: SearchResult[] }>('/search', { q: query, limit: 12 }).subscribe({
        next: (result) => {
          this.recordResults.set(result.results ?? []);
          this.paletteIndex.set(0);
          this.revealPalette();
        },
        error: () => this.recordResults.set([]),
      });
    }, 250);
  }

  onOverlay(event: MouseEvent): void {
    if (event.target === event.currentTarget) {
      this.closeMenu();
      this.paletteOpen.set(false);
    }
  }

  private readonly hotkey = (event: KeyboardEvent): void => {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
      event.preventDefault();
      this.openPalette();
    }
    if (this.paletteOpen()) {
      if (event.key === 'Escape') {
        this.paletteOpen.set(false);
        return;
      }
      const count = this.paletteResults().length;
      const actions: Record<string, () => void> = {
        ArrowDown: () => this.movePalette(1),
        ArrowUp: () => this.movePalette(-1),
        PageDown: () => this.movePalette(6),
        PageUp: () => this.movePalette(-6),
        Home: () => this.setPaletteIndex(0),
        End: () => this.setPaletteIndex(count - 1),
      };
      const action = actions[event.key];
      if (action) {
        // Stop the page behind the dialog from scrolling, even if focus escaped.
        event.preventDefault();
        action();
        return;
      }
      if (event.key === 'Enter') {
        event.preventDefault();
        const item = this.paletteResults()[Math.min(this.paletteIndex(), count - 1)];
        if (item) this.go(item);
        return;
      }
    }
    if (event.key === 'Escape') {
      this.closeMenu();
      this.paletteOpen.set(false);
      this.userOpen.set(false);
    }
  };
}

