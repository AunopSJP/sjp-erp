import {
  AfterViewInit,
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  HostListener,
  computed,
  inject,
  input,
  output,
  signal,
  viewChild,
} from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';
import { Router, RouterLink, RouterLinkActive } from '@angular/router';
import { IconComponent } from '../shared/icon.component';

export interface SideNavItem {
  path: string;
  label: string;
  short?: string;
  description?: string;
  alias?: string;
  icon: string;
  resource?: string;
}

export interface SideNavGroup {
  label: string;
  icon: string;
  items: SideNavItem[];
}

export type SideNavMode = 'expanded' | 'rail' | 'drawer';

@Component({
  selector: 'app-side-nav',
  standalone: true,
  imports: [NgTemplateOutlet, RouterLink, RouterLinkActive, IconComponent],
  template: `
    <aside
      class="sb"
      [class.sb-expanded]="mode() === 'expanded'"
      [class.sb-rail]="mode() === 'rail'"
      [class.sb-drawer]="mode() === 'drawer'"
      aria-label="เมนูหลัก"
    >
      <div class="sb-head">
        <a class="sb-logo" routerLink="/" (click)="onNavigate()">
          <b>SJP</b>
          <span class="sb-brand"><strong>ERP</strong><small>ระบบงานบริษัท</small></span>
        </a>
        @if (mode() === 'drawer') {
          <button class="sb-icon-btn" type="button" (click)="closeDrawer.emit()" aria-label="ปิดเมนู">
            <app-icon name="close" [size]="18" />
          </button>
        } @else if (mode() === 'expanded') {
          <button class="sb-icon-btn sb-collapse" type="button" (click)="toggleCollapse.emit()" aria-label="ย่อเมนู" title="ย่อเมนู">
            <app-icon name="columns" [size]="18" />
          </button>
        }
      </div>

      @if (mode() === 'rail') {
        <div class="sb-rail-list">
          @for (group of groups(); track group.label) {
            <div
              class="sb-rail-wrap"
              (mouseenter)="openFlyout(group, $event)"
              (mouseleave)="scheduleClose()"
              (focusout)="onRailFocusOut($event)"
            >
              <button
                type="button"
                class="sb-rail-btn"
                [class.active]="isGroupActive(group)"
                [attr.aria-expanded]="flyout() === group.label"
                [attr.data-group]="group.label"
                [attr.aria-label]="group.label + (groupBadge(group) ? ' (' + groupBadge(group) + ')' : '')"
                [attr.title]="group.label"
                (click)="openFlyout(group, $event)"
              >
                <app-icon [name]="group.icon" [size]="20" />
                @if (groupBadge(group)) {
                  <span class="sb-rail-badge">{{ groupBadge(group) }}</span>
                }
              </button>

              @if (flyout() === group.label) {
                <div
                  class="sb-flyout"
                  role="group"
                  [attr.aria-label]="group.label"
                  [style.top.px]="flyTop()"
                  [style.left.px]="flyLeft()"
                  (mouseenter)="cancelClose()"
                >
                  <div class="sb-flyout-head">
                    <app-icon [name]="group.icon" [size]="16" />
                    <span>{{ group.label }}</span>
                  </div>
                  <div class="sb-flyout-body">
                    @for (item of group.items; track item.path) {
                      <ng-container [ngTemplateOutlet]="row" [ngTemplateOutletContext]="{ $implicit: item }" />
                    }
                  </div>
                </div>
              }
            </div>
          }
        </div>

        <div class="sb-foot sb-rail-foot">
          <button
            class="sb-icon-btn"
            type="button"
            (click)="toggleTheme.emit()"
            [attr.aria-label]="theme() === 'dark' ? 'ใช้โหมดสว่าง' : 'ใช้โหมดมืด'"
            [attr.title]="theme() === 'dark' ? 'โหมดสว่าง' : 'โหมดมืด'"
          >
            <app-icon [name]="theme() === 'dark' ? 'sun' : 'moon'" [size]="18" />
          </button>
          <button class="sb-icon-btn" type="button" (click)="toggleCollapse.emit()" aria-label="ขยายเมนู" title="ขยายเมนู">
            <app-icon name="columns" [size]="18" />
          </button>
        </div>
      } @else {
        <div class="sb-search">
          <app-icon name="search" [size]="16" />
          <input
            #navSearch
            type="text"
            [value]="query()"
            (input)="setQuery($any($event.target).value)"
            (keydown)="searchKey($event)"
            placeholder="ค้นหาเมนู…"
            aria-label="ค้นหาเมนู"
            autocomplete="off"
            spellcheck="false"
          />
          @if (query()) {
            <button class="sb-clear" type="button" (click)="query.set('')" aria-label="ล้างคำค้นหา">
              <app-icon name="close" [size]="14" />
            </button>
          } @else {
            <kbd>/</kbd>
          }
        </div>

        <div class="sb-scroll">
          @if (query().trim()) {
            @if (!filteredGroups().length) {
              <div class="sb-empty">ไม่พบเมนูที่ตรงกับ “{{ query() }}”</div>
            } @else {
              <div class="sb-results">
                @for (group of filteredGroups(); track group.label) {
                  <div class="sb-result-group">
                    <div class="sb-section-label">{{ group.label }}</div>
                    @for (item of group.items; track item.path) {
                      <ng-container [ngTemplateOutlet]="row" [ngTemplateOutletContext]="{ $implicit: item }" />
                    }
                  </div>
                }
              </div>
            }
          } @else {
            @if (favoriteItems().length) {
              <div class="sb-section">
                <div class="sb-section-label"><app-icon name="star" [size]="13" /> รายการโปรด</div>
                @for (item of favoriteItems(); track item.path) {
                  <ng-container [ngTemplateOutlet]="row" [ngTemplateOutletContext]="{ $implicit: item, favorite: true }" />
                }
              </div>
            }

            <div class="sb-groups">
              @for (group of groups(); track group.label) {
                <div class="sb-group">
                  <button
                    type="button"
                    class="sb-group-head"
                    [class.active]="isGroupActive(group)"
                    [attr.aria-expanded]="isOpen(group)"
                    [attr.aria-controls]="groupId(group)"
                    (click)="toggleGroup.emit(group.label)"
                  >
                    <span class="sb-group-ic"><app-icon [name]="group.icon" [size]="17" /></span>
                    <span class="sb-group-label">{{ group.label }}</span>
                    @if (groupBadge(group)) {
                      <span class="sb-badge">{{ groupBadge(group) }}</span>
                    }
                    <span class="sb-chev" [class.open]="isOpen(group)"><app-icon name="chevron" [size]="14" /></span>
                  </button>

                  @if (isOpen(group)) {
                    <div class="sb-items" [id]="groupId(group)">
                      @for (item of group.items; track item.path) {
                        <ng-container [ngTemplateOutlet]="row" [ngTemplateOutletContext]="{ $implicit: item }" />
                      }
                    </div>
                  }
                </div>
              }
            </div>
          }
        </div>
      }
    </aside>

    <ng-template #row let-item let-favorite="favorite">
      <div
        class="sb-row"
        [class.dragging]="dragging() === item.path"
        [class.drop-target]="dropTarget() === item.path"
        [attr.draggable]="favorite ? 'true' : null"
        (dragstart)="onDragStart($event, item.path, favorite)"
        (dragover)="onDragOver($event, item.path, favorite)"
        (dragleave)="onDragLeave(item.path)"
        (drop)="onDrop($event, item.path, favorite)"
        (dragend)="onDragEnd()"
      >
        <a
          class="sb-item"
          [routerLink]="item.path"
          routerLinkActive="active"
          [routerLinkActiveOptions]="{ exact: item.path === '/' }"
          ariaCurrentWhenActive="page"
          [attr.title]="item.label"
          [attr.draggable]="favorite ? 'false' : null"
          (click)="onNavigate()"
        >
          <span class="sb-ic"><app-icon [name]="item.icon" [size]="18" /></span>
          <span class="sb-label">{{ item.label }}</span>
          @if (item.path === '/approvals' && pendingApprovals()) {
            <span class="sb-badge">{{ pendingApprovals() }}</span>
          }
        </a>
        <button
          type="button"
          class="sb-star"
          [class.on]="isFavorite(item.path)"
          [attr.aria-pressed]="isFavorite(item.path)"
          [attr.aria-label]="(isFavorite(item.path) ? 'ยกเลิกปักหมุด ' : 'ปักหมุด ') + item.label"
          [attr.title]="isFavorite(item.path) ? 'ยกเลิกปักหมุด' : 'ปักหมุด'"
          (click)="onStar($event, item.path)"
        >
          <app-icon name="star" [size]="14" />
        </button>
      </div>
    </ng-template>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SideNavComponent implements AfterViewInit {
  readonly mode = input<SideNavMode>('expanded');
  readonly groups = input<SideNavGroup[]>([]);
  readonly catalog = input<SideNavItem[]>([]);
  readonly favorites = input<string[]>([]);
  readonly closedGroups = input<string[]>([]);
  readonly currentUrl = input('');
  readonly pendingApprovals = input(0);
  readonly theme = input<'dark' | 'light'>('dark');

  readonly toggleFavorite = output<string>();
  readonly reorderFavorites = output<string[]>();
  readonly toggleGroup = output<string>();
  readonly toggleCollapse = output<void>();
  readonly toggleTheme = output<void>();
  readonly closeDrawer = output<void>();

  readonly query = signal('');
  readonly dragging = signal<string | null>(null);
  readonly dropTarget = signal<string | null>(null);
  readonly flyout = signal<string | null>(null);
  readonly flyTop = signal(0);
  readonly flyLeft = signal(0);

  private readonly router = inject(Router);
  private readonly host = inject(ElementRef) as ElementRef<HTMLElement>;
  private readonly searchInput = viewChild<ElementRef<HTMLInputElement>>('navSearch');
  private closeTimer: ReturnType<typeof setTimeout> | null = null;

  readonly favoriteItems = computed<SideNavItem[]>(() =>
    this.favorites()
      .map((path) => this.findItem(path))
      .filter((item): item is SideNavItem => !!item),
  );

  readonly filteredGroups = computed<SideNavGroup[]>(() => {
    const query = this.query().trim().toLowerCase();
    if (!query) return this.groups();
    return this.groups()
      .map((group) => ({
        ...group,
        items: group.items.filter((item) =>
          `${item.label} ${item.short ?? ''} ${group.label}`.toLowerCase().includes(query),
        ),
      }))
      .filter((group) => group.items.length);
  });

  ngAfterViewInit(): void {
    if (this.mode() === 'drawer') {
      setTimeout(() => {
        const search = this.host.nativeElement.querySelector<HTMLElement>('.sb-search input');
        const fallback = this.host.nativeElement.querySelector<HTMLElement>('.sb-item, .sb-icon-btn');
        (search ?? fallback)?.focus();
      }, 0);
    }
  }

  private findItem(path: string): SideNavItem | undefined {
    return this.catalog().find((item) => item.path === path);
  }

  isFavorite(path: string): boolean {
    return this.favorites().includes(path);
  }

  isOpen(group: SideNavGroup): boolean {
    if (this.query().trim()) return true;
    return !this.closedGroups().includes(group.label);
  }

  groupId(group: SideNavGroup): string {
    return `sb-group-${group.label.replace(/[^a-zA-Z0-9ก-๙]+/g, '-')}`;
  }

  isActive(path: string): boolean {
    const url = this.currentUrl().split('?')[0];
    if (path === '/') return url === '/';
    return url === path || url.startsWith(`${path}/`);
  }

  isGroupActive(group: SideNavGroup): boolean {
    return group.items.some((item) => this.isActive(item.path));
  }

  groupBadge(group: SideNavGroup): number {
    return group.items.some((item) => item.path === '/approvals') ? this.pendingApprovals() : 0;
  }

  setQuery(value: string): void {
    this.query.set(value);
  }

  searchKey(event: KeyboardEvent): void {
    if (event.key === 'Escape') {
      event.stopPropagation();
      this.query.set('');
      return;
    }
    if (event.key === 'Enter') {
      const first = this.filteredGroups()[0]?.items[0];
      if (first) {
        event.preventDefault();
        void this.router.navigateByUrl(first.path);
        this.query.set('');
        this.onNavigate();
      }
      return;
    }
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      const firstLink = this.host.nativeElement.querySelector<HTMLElement>('.sb-results .sb-item');
      firstLink?.focus();
    }
  }

  onNavigate(): void {
    if (this.mode() === 'drawer') this.closeDrawer.emit();
  }

  onStar(event: MouseEvent, path: string): void {
    event.preventDefault();
    event.stopPropagation();
    this.toggleFavorite.emit(path);
  }

  onDragStart(event: DragEvent, path: string, favorite: boolean): void {
    if (!favorite) {
      event.preventDefault();
      return;
    }
    this.dragging.set(path);
    if (event.dataTransfer) {
      event.dataTransfer.effectAllowed = 'move';
      event.dataTransfer.setData('text/plain', path);
    }
  }

  onDragOver(event: DragEvent, path: string, favorite: boolean): void {
    if (!favorite || !this.dragging() || this.dragging() === path) return;
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
    this.dropTarget.set(path);
  }

  onDragLeave(path: string): void {
    if (this.dropTarget() === path) this.dropTarget.set(null);
  }

  onDrop(event: DragEvent, path: string, favorite: boolean): void {
    event.preventDefault();
    const from = this.dragging();
    if (!favorite || !from || from === path) {
      this.onDragEnd();
      return;
    }
    const list = [...this.favorites()];
    const fromIndex = list.indexOf(from);
    const targetIndex = list.indexOf(path);
    if (fromIndex < 0 || targetIndex < 0) {
      this.onDragEnd();
      return;
    }
    list.splice(fromIndex, 1);
    list.splice(targetIndex, 0, from);
    this.reorderFavorites.emit(list);
    this.onDragEnd();
  }

  onDragEnd(): void {
    this.dragging.set(null);
    this.dropTarget.set(null);
  }

  openFlyout(group: SideNavGroup, event: Event): void {
    if (this.mode() !== 'rail') return;
    this.cancelClose();
    const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
    const height = Math.min(window.innerHeight - 24, 96 + group.items.length * 40);
    this.flyTop.set(Math.max(12, Math.min(rect.top, window.innerHeight - height - 12)));
    this.flyLeft.set(rect.right + 10);
    this.flyout.set(group.label);
  }

  scheduleClose(): void {
    this.cancelClose();
    this.closeTimer = setTimeout(() => this.flyout.set(null), 180);
  }

  cancelClose(): void {
    if (this.closeTimer) clearTimeout(this.closeTimer);
    this.closeTimer = null;
  }

  onRailFocusOut(event: FocusEvent): void {
    const next = event.relatedTarget as Node | null;
    if (next && (event.currentTarget as HTMLElement).contains(next)) return;
    this.scheduleClose();
  }

  private closeFlyout(restoreFocus = false): void {
    const label = this.flyout();
    this.flyout.set(null);
    if (restoreFocus && label) {
      const buttons = this.host.nativeElement.querySelectorAll<HTMLElement>('.sb-rail-btn');
      const target = [...buttons].find((button) => button.dataset['group'] === label);
      target?.focus();
    }
  }

  private trapFocus(event: KeyboardEvent): void {
    const items = [...this.host.nativeElement.querySelectorAll<HTMLElement>(
      'a[href], button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])',
    )].filter((element) => element.offsetParent !== null);
    if (!items.length) return;
    const first = items[0];
    const last = items[items.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  @HostListener('document:keydown', ['$event'])
  onDocumentKey(event: KeyboardEvent): void {
    if (event.key === 'Escape' && this.flyout()) {
      event.stopPropagation();
      this.closeFlyout(true);
      return;
    }
    if (this.mode() === 'drawer' && event.key === 'Tab') {
      this.trapFocus(event);
      return;
    }
    if (event.key !== '/' || this.mode() === 'rail') return;
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    const target = event.target as HTMLElement | null;
    if (
      target &&
      (target.tagName === 'INPUT' ||
        target.tagName === 'TEXTAREA' ||
        target.tagName === 'SELECT' ||
        target.isContentEditable)
    ) {
      return;
    }
    if (document.querySelector('.overlay, .modal-back')) return;
    event.preventDefault();
    this.searchInput()?.nativeElement.focus();
  }

  @HostListener('document:pointerdown', ['$event'])
  onDocumentPointer(event: PointerEvent): void {
    if (!this.flyout()) return;
    const target = event.target as HTMLElement | null;
    if (target?.closest('.sb-rail-wrap, .sb-flyout')) return;
    this.closeFlyout();
  }

  @HostListener('window:scroll')
  onWindowScroll(): void {
    if (this.flyout()) this.closeFlyout();
  }
}
