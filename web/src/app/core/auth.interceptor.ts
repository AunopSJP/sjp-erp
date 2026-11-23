import { Injector, inject } from '@angular/core';
import { HttpInterceptorFn } from '@angular/common/http';
import { catchError, throwError } from 'rxjs';
import { AuthService } from './auth.service';
import { readActiveWorkspace, readCookie, readToken, writeToken } from './storage';

const MUTATING = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
const AUTH_ENDPOINTS = ['/auth/login', '/auth/setup', '/auth/me', '/auth/status'];

export const authInterceptor: HttpInterceptorFn = (req, next) => {
  const injector = inject(Injector);
  const token = readToken();
  const csrf = readCookie('sjp_csrf');
  const headers: Record<string, string> = {};
  if (token) headers['Authorization'] = `Bearer ${token}`;
  const workspace = readActiveWorkspace();
  if (workspace) headers['X-Workspace-ID'] = workspace;
  if (csrf && MUTATING.has(req.method.toUpperCase())) headers['X-CSRF-Token'] = csrf;
  const request = req.clone({ withCredentials: true, setHeaders: headers });
  return next(request).pipe(
    catchError((error: unknown) => {
      const status = (error as { status?: number })?.status;
      if (status === 401 && !AUTH_ENDPOINTS.some((path) => request.url.includes(path))) {
        writeToken('');
        injector.get(AuthService).handleSessionExpired();
      }
      return throwError(() => error);
    }),
  );
};
