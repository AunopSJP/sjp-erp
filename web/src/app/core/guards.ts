import { inject } from '@angular/core';
import { ActivatedRouteSnapshot, CanActivateFn, Router, RouterStateSnapshot } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { AuthService } from './auth.service';
import { MetaService } from './meta.service';
import { ToastService } from '../shared/toast.service';

export const authGuard: CanActivateFn = (_route: ActivatedRouteSnapshot, state: RouterStateSnapshot) => {
  const auth = inject(AuthService);
  const router = inject(Router);
  if (auth.user()) return true;
  const redirect = state.url && state.url !== '/' ? state.url : undefined;
  return router.createUrlTree(['/login'], { queryParams: redirect ? { redirect } : {} });
};

export const loginGuard: CanActivateFn = () => {
  const auth = inject(AuthService);
  const router = inject(Router);
  if (!auth.user()) return true;
  return router.parseUrl('/');
};

/**
 * Blocks deep links to modules the signed-in role cannot view (or cannot create
 * for create-only screens). Navigation already hides these entries; this keeps
 * a pasted URL from rendering a page full of permission errors.
 */
export const moduleGuard = (resource: string, action = 'view'): CanActivateFn => () => {
  const auth = inject(AuthService);
  const router = inject(Router);
  const toast = inject(ToastService);
  if (!auth.user()) return router.parseUrl('/login');
  if (auth.can(resource, action)) return true;
  toast.error('ไม่พบรายการหรือคุณไม่มีสิทธิ์เข้าถึง');
  return router.parseUrl('/apps');
};

/** Same protection for metadata-driven entity routes (/entities/:entity). */
export const entityGuard: CanActivateFn = async (route: ActivatedRouteSnapshot) => {
  const auth = inject(AuthService);
  const router = inject(Router);
  const toast = inject(ToastService);
  const meta = inject(MetaService);
  if (!auth.user()) return router.parseUrl('/login');
  const key = route.paramMap.get('entity') ?? '';
  try {
    const definition = (await firstValueFrom(meta.ensureLoaded(true))).entities[key];
    if (definition?.can?.['view']) return true;
  } catch {
    toast.error('โหลดข้อมูลโมดูลไม่ได้ กรุณาลองใหม่');
    return router.parseUrl('/apps');
  }
  toast.error('ไม่พบรายการหรือคุณไม่มีสิทธิ์เข้าถึง');
  return router.parseUrl('/apps');
};
