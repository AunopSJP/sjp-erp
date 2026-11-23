import { Routes } from '@angular/router';
import { authGuard, entityGuard, loginGuard, moduleGuard } from './core/guards';
import { leaveWithPendingEdits } from './core/pending-edits.service';

export const routes: Routes = [
  {
    path: 'login',
    canActivate: [loginGuard],
    loadComponent: () => import('./pages/login.component').then((m) => m.LoginComponent),
  },
  {
    path: '',
    canActivate: [authGuard],
    loadComponent: () => import('./shell/shell.component').then((m) => m.ShellComponent),
    children: [
      { path: '', loadComponent: () => import('./pages/dashboard.component').then((m) => m.DashboardComponent) },
      { path: 'apps', loadComponent: () => import('./pages/app-launcher.component').then((m) => m.AppLauncherComponent) },
      { path: 'workspace', loadComponent: () => import('./pages/workspace.component').then((m) => m.WorkspaceComponent) },
      { path: 'my', loadComponent: () => import('./pages/my-work.component').then((m) => m.MyWorkComponent) },
      { path: 'account', loadComponent: () => import('./pages/account.component').then((m) => m.AccountComponent) },
      { path: 'approvals', loadComponent: () => import('./pages/approvals.component').then((m) => m.ApprovalsComponent) },
      { path: 'entities/:entity', canActivate: [entityGuard], canDeactivate: [leaveWithPendingEdits], loadComponent: () => import('./pages/entity-list.component').then((m) => m.EntityListComponent) },
      { path: 'entities/:entity/:id', canActivate: [entityGuard], canDeactivate: [leaveWithPendingEdits], loadComponent: () => import('./pages/entity-detail.component').then((m) => m.EntityDetailComponent) },
      {
        path: 'tickets',
        canActivate: [moduleGuard('tickets')],
        loadComponent: () => import('./pages/tickets.component').then((m) => m.TicketsComponent),
      },
      {
        path: 'tickets/new',
        canActivate: [moduleGuard('tickets', 'create')],
        loadComponent: () => import('./pages/ticket-new.component').then((m) => m.TicketNewComponent),
      },
      {
        path: 'tickets/:id',
        canActivate: [moduleGuard('tickets')],
        loadComponent: () => import('./pages/ticket-detail.component').then((m) => m.TicketDetailComponent),
      },
      {
        path: 'projects',
        canActivate: [moduleGuard('projects')],
        loadComponent: () => import('./pages/projects.component').then((m) => m.ProjectsComponent),
      },
      {
        path: 'projects/:id',
        canActivate: [moduleGuard('projects')],
        loadComponent: () => import('./pages/project-detail.component').then((m) => m.ProjectDetailComponent),
      },
      { path: 'calendar', loadComponent: () => import('./pages/calendar.component').then((m) => m.CalendarComponent) },
      {
        path: 'vehicles',
        canActivate: [moduleGuard('vehicleBookings')],
        loadComponent: () => import('./pages/vehicle-booking.component').then((m) => m.VehicleBookingComponent),
      },
      {
        path: 'purchase-orders',
        canActivate: [moduleGuard('purchase')],
        canDeactivate: [leaveWithPendingEdits],
        loadComponent: () => import('./pages/purchase.component').then((m) => m.PurchaseComponent),
      },
      {
        path: 'purchase-orders/:id',
        canActivate: [moduleGuard('purchase')],
        canDeactivate: [leaveWithPendingEdits],
        loadComponent: () => import('./pages/purchase-detail.component').then((m) => m.PurchaseDetailComponent),
      },
      {
        path: 'warehouse',
        canActivate: [moduleGuard('warehouse')],
        loadComponent: () => import('./pages/warehouse.component').then((m) => m.WarehouseComponent),
      },
      {
        path: 'pm',
        canActivate: [moduleGuard('pm')],
        loadComponent: () => import('./pages/pm.component').then((m) => m.PmComponent),
      },
      {
        path: 'pm/records/:id',
        canActivate: [moduleGuard('pm')],
        loadComponent: () => import('./pages/pm-record.component').then((m) => m.PmRecordComponent),
      },
      {
        path: 'reports',
        canActivate: [moduleGuard('reports')],
        loadComponent: () => import('./pages/reports.component').then((m) => m.ReportsComponent),
      },
      {
        path: 'settings',
        canActivate: [moduleGuard('settings')],
        loadComponent: () => import('./pages/settings.component').then((m) => m.SettingsComponent),
      },
      { path: '**', redirectTo: '' },
    ],
  },
];
