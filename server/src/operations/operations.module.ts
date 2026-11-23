import { Module } from '@nestjs/common';
import { RecordsModule } from '../records/records.module.js';
import { PdfModule } from '../pdf/pdf.module.js';
import { AccountingController } from './accounting.controller.js';
import { AccountingService } from './accounting.service.js';
import { ApprovalDecisionService } from './approval-decision.service.js';
import { ApprovalsController } from './approvals.controller.js';
import { CalendarController, NotificationsController } from './calendar.controller.js';
import { CalendarService } from './calendar.service.js';
import { DashboardService } from './dashboard.service.js';
import { NotificationsService } from './notifications.service.js';
import {
  DashboardController,
  PmController,
  ProjectsController,
  PurchasingController,
  ReportsController,
  StockController,
  TicketsController,
} from './operations.controllers.js';
import { PmService } from './pm.service.js';
import { ProjectsService } from './projects.service.js';
import { PurchasingService } from './purchasing.service.js';
import { ReportsService } from './reports.service.js';
import { StockService } from './stock.service.js';
import { TicketsService } from './tickets.service.js';

@Module({
  imports: [RecordsModule, PdfModule],
  controllers: [
    TicketsController,
    ProjectsController,
    PurchasingController,
    StockController,
    PmController,
    DashboardController,
    ReportsController,
    ApprovalsController,
    CalendarController,
    NotificationsController,
    AccountingController,
  ],
  providers: [
    TicketsService,
    ProjectsService,
    PurchasingService,
    StockService,
    PmService,
    DashboardService,
    ReportsService,
    ApprovalDecisionService,
    CalendarService,
    NotificationsService,
    AccountingService,
  ],
  exports: [StockService],
})
export class OperationsModule {}
