import { ChangeDetectionStrategy, Component, computed, inject, signal, type Signal } from '@angular/core';
import { ROUTER_OUTLET_DATA, RouterLink } from '@angular/router';
import { IconComponent } from '../shared/icon.component';
import type { SideNavItem } from '../shell/side-nav.component';

type LauncherItem = SideNavItem & { group: string };

export interface LauncherContext {
  items: LauncherItem[];
  favorites: string[];
  recent: string[];
  loading: boolean;
  failed: boolean;
  canCreate: boolean;
  retry: () => void;
  toggleFavorite: (path: string) => void;
}

const PAGE_SIZE = 24;

@Component({
  selector: 'app-launcher',
  imports: [RouterLink, IconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './app-launcher.component.html',
  styleUrl: './app-launcher.component.css',
})
export class AppLauncherComponent {
  readonly context = inject(ROUTER_OUTLET_DATA) as Signal<LauncherContext>;
  readonly query = signal('');
  readonly category = signal('');
  readonly limit = signal(PAGE_SIZE);
  readonly categories = computed(() => [...new Set(this.context().items.map((item) => item.group))]);
  readonly filtered = computed(() => {
    const query = this.query().trim().toLowerCase();
    const category = this.category();
    return this.context().items.filter((item) =>
      (!category || item.group === category) &&
      [item.label, item.short, item.description, item.path, item.group, item.alias]
        .some((value) => value?.toLowerCase().includes(query)),
    );
  });
  readonly items = computed(() => this.filtered().slice(0, this.limit()));
  readonly browsing = computed(() => !this.query().trim() && !this.category());
  readonly favorites = computed(() => this.shortcuts(this.context().favorites));
  readonly recent = computed(() => this.shortcuts(this.context().recent));

  private shortcuts(paths: string[]): LauncherItem[] {
    const byPath = new Map(this.context().items.map((item) => [item.path, item]));
    return paths.flatMap((path) => {
      const item = byPath.get(path);
      return item ? [item] : [];
    });
  }

  setQuery(value: string): void {
    this.query.set(value);
    this.limit.set(PAGE_SIZE);
  }

  setCategory(value: string): void {
    this.category.set(value);
    this.limit.set(PAGE_SIZE);
  }

  loadMore(): void {
    this.limit.update((limit) => limit + PAGE_SIZE);
  }
}
