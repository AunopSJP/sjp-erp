import { TestBed } from '@angular/core/testing';
import { of, throwError, type Observable } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';
import { CompanySettingsComponent } from './company-settings.component';
import { ApiService } from '../core/api.service';
import { AuthService } from '../core/auth.service';
import { MetaService } from '../core/meta.service';
import { ToastService } from '../shared/toast.service';

describe('CompanySettingsComponent', () => {
  const mount = async (response: Observable<unknown>) => {
    const put = vi.fn(() => of({}));
    await TestBed.configureTestingModule({
      imports: [CompanySettingsComponent],
      providers: [
        { provide: ApiService, useValue: { get: () => response, put } },
        { provide: AuthService, useValue: { can: () => true } },
        { provide: MetaService, useValue: { load: vi.fn() } },
        { provide: ToastService, useValue: { show: vi.fn(), error: vi.fn() } },
      ],
    }).compileComponents();
    const fixture = TestBed.createComponent(CompanySettingsComponent);
    fixture.detectChanges();
    const button = (fixture.nativeElement as HTMLElement).querySelector('button') as HTMLButtonElement;
    return { fixture, button, put };
  };

  it('does not save over the stored settings when loading them failed', async () => {
    const { fixture, button, put } = await mount(throwError(() => new Error('offline')));

    expect(button.disabled).toBe(true);
    fixture.componentInstance.save();
    expect(put).not.toHaveBeenCalled();
  });

  it('saves the loaded settings', async () => {
    const { button, put } = await mount(of({ name: 'SJP', slaSampleAlerts: false }));

    button.click();
    expect(put).toHaveBeenCalledWith('/company', expect.objectContaining({ slaSampleAlerts: false }));
  });
});
