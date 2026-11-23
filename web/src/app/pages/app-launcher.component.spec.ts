import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter, ROUTER_OUTLET_DATA } from '@angular/router';
import { describe, expect, it } from 'vitest';
import { AppLauncherComponent, type LauncherContext } from './app-launcher.component';

describe('AppLauncherComponent', () => {
  it('limits rendered modules and finds module 501 without loading earlier cards', () => {
    const items = Array.from({ length: 501 }, (_, index) => ({
      path: `/entities/test${index + 1}`,
      label: `โมดูล ${index + 1}`,
      group: 'ทดสอบ',
      icon: 'grid',
    }));
    const context = signal<LauncherContext>({
      items, favorites: [], recent: [], loading: false, failed: false, canCreate: false,
      retry: () => undefined, toggleFavorite: () => undefined,
    });
    TestBed.configureTestingModule({
      providers: [provideRouter([]), { provide: ROUTER_OUTLET_DATA, useValue: context }],
    });
    const fixture = TestBed.createComponent(AppLauncherComponent);
    fixture.detectChanges();
    const host = fixture.nativeElement as HTMLElement;
    expect(host.querySelectorAll('a[href^="/entities/"]')).toHaveLength(24);
    const more = [...host.querySelectorAll('button')].find((item) => item.textContent?.includes('โหลดเพิ่ม'));
    more?.click();
    fixture.detectChanges();
    expect(host.querySelectorAll('a[href^="/entities/"]')).toHaveLength(48);
    const search = host.querySelector<HTMLInputElement>('input[type="search"]')!;
    search.value = 'test501';
    search.dispatchEvent(new Event('input'));
    fixture.detectChanges();
    expect(host.querySelector('a[href="/entities/test501"]')?.textContent).toContain('โมดูล 501');
    expect(host.querySelectorAll('a[href^="/entities/"]')).toHaveLength(1);
    search.value = '';
    search.dispatchEvent(new Event('input'));
    context.update((current) => ({
      ...current, favorites: ['/entities/test501'], recent: ['/entities/test501'],
    }));
    fixture.detectChanges();
    expect(host.querySelectorAll('.launcher-shortcuts a[href="/entities/test501"]')).toHaveLength(2);
    context.update((current) => ({ ...current, items: items.slice(0, 500) }));
    fixture.detectChanges();
    expect(host.querySelector('a[href="/entities/test501"]')).toBeNull();
  });
});
