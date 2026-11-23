import { Body, Controller, Get, Param, Patch, Post, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import { CurrentUser } from '../auth/current-user.decorator.js';
import type { SafeUser } from '../auth/user.types.js';
import { AccessService } from '../common/access.service.js';
import { parseListQuery } from '../records/list-query.js';
import { DashboardService } from './dashboard.service.js';
import { PmService } from './pm.service.js';
import { ProjectsService } from './projects.service.js';
import { PurchasingService } from './purchasing.service.js';
import { ReportsService } from './reports.service.js';
import { StockService } from './stock.service.js';
import { TicketsService } from './tickets.service.js';
import {
  ApprovalDecisionDto,
  AppointmentDto,
  AppointmentResolveDto,
  PmGenerateDto,
  PmSaveDto,
  PmTemplateDto,
  PoReceiveDto,
  PoStatusDto,
  ProjectCreateDto,
  ReasonDto,
  StockMoveDto,
  StockReceiveDto,
  TicketAssignDto,
  TicketCreateDto,
  TicketNoteDto,
  TicketStatusDto,
} from './operations.dto.js';

@Controller('tickets')
export class TicketsController {
  constructor(private readonly tickets: TicketsService) {}

  @Post()
  create(@CurrentUser() user: SafeUser, @Body() body: TicketCreateDto) {
    return this.tickets.create(user, body as unknown as Record<string, unknown>);
  }

  @Post(':id/status')
  status(
    @CurrentUser() user: SafeUser,
    @Param('id') id: string,
    @Body() body: TicketStatusDto,
  ) {
    return this.tickets.status(user, id, String(body.to ?? ''), {
      comment: body.comment,
      fields: body.fields ?? {},
    });
  }

  @Post(':id/assign')
  assign(
    @CurrentUser() user: SafeUser,
    @Param('id') id: string,
    @Body() body: TicketAssignDto,
  ) {
    return this.tickets.assign(user, id, body.team, body.assignee, body.note);
  }

  @Post(':id/notes')
  note(
    @CurrentUser() user: SafeUser,
    @Param('id') id: string,
    @Body() body: TicketNoteDto,
  ) {
    return this.tickets.note(user, id, String(body.type ?? 'note'), String(body.text ?? ''));
  }

  @Post(':id/appointments')
  appointment(@CurrentUser() user: SafeUser, @Param('id') id: string, @Body() body: AppointmentDto) {
    return this.tickets.addAppointment(user, id, body as unknown as Record<string, unknown>);
  }

  @Post(':id/appointments/:appointmentId/resolve')
  resolveAppointment(
    @CurrentUser() user: SafeUser,
    @Param('id') id: string,
    @Param('appointmentId') appointmentId: string,
    @Body() body: AppointmentResolveDto,
  ) {
    return this.tickets.resolveAppointment(user, id, appointmentId, String(body.status ?? 'เสร็จ'), body.result);
  }
}

@Controller('projects')
export class ProjectsController {
  constructor(private readonly projects: ProjectsService) {}

  @Post()
  create(@CurrentUser() user: SafeUser, @Body() body: ProjectCreateDto) {
    return this.projects.create(user, body as unknown as Record<string, unknown>);
  }

  @Patch(':id/steps/:key')
  saveStep(
    @CurrentUser() user: SafeUser,
    @Param('id') id: string,
    @Param('key') key: string,
    @Body() body: Record<string, unknown>,
  ) {
    return this.projects.saveStep(user, id, key, body ?? {});
  }

  @Post(':id/steps/:key/:action')
  transit(
    @CurrentUser() user: SafeUser,
    @Param('id') id: string,
    @Param('key') key: string,
    @Param('action') action: string,
    @Body() body: ReasonDto,
  ) {
    const allowed = ['start', 'complete', 'skip', 'reopen'] as const;
    if (!allowed.includes(action as (typeof allowed)[number])) {
      return { error: 'ไม่พบคำสั่งขั้นตอน' };
    }
    return this.projects.transit(user, id, key, action as (typeof allowed)[number], body ?? {});
  }

  @Post(':id/close')
  close(@CurrentUser() user: SafeUser, @Param('id') id: string, @Body() body: ReasonDto) {
    return this.projects.close(user, id, String(body.reason ?? ''));
  }
}

@Controller('purchase-orders')
export class PurchasingController {
  constructor(private readonly purchasing: PurchasingService) {}

  @Get()
  list(@CurrentUser() user: SafeUser) {
    return this.purchasing.list(user);
  }

  @Get('page')
  page(@CurrentUser() user: SafeUser, @Query() query: Record<string, string>) {
    return this.purchasing.page(user, parseListQuery(query));
  }

  @Get(':id')
  detail(@CurrentUser() user: SafeUser, @Param('id') id: string) {
    return this.purchasing.detail(user, id);
  }

  @Post(':id/status')
  status(
    @CurrentUser() user: SafeUser,
    @Param('id') id: string,
    @Body() body: PoStatusDto,
  ) {
    return this.purchasing.status(user, id, String(body.to ?? ''), body.comment);
  }

  @Post(':id/receive')
  receive(
    @CurrentUser() user: SafeUser,
    @Param('id') id: string,
    @Body() body: PoReceiveDto,
  ) {
    return this.purchasing.receive(user, id, String(body.warehouse ?? ''), body.lines ?? []);
  }
}

@Controller('stock')
export class StockController {
  constructor(
    private readonly stock: StockService,
    private readonly access: AccessService,
  ) {}

  @Get('balances')
  balances(@CurrentUser() user: SafeUser) {
    this.access.require(user, 'warehouse', 'view');
    return this.stock.balances();
  }

  @Get('moves')
  moves(@CurrentUser() user: SafeUser, @Query() query: Record<string, string>) {
    return this.stock.list(user, query);
  }

  @Post('moves')
  create(@CurrentUser() user: SafeUser, @Body() body: StockMoveDto) {
    return this.stock.createMove(user, body as never);
  }

  @Post('receive')
  receive(@CurrentUser() user: SafeUser, @Body() body: StockReceiveDto) {
    return this.stock.receiveManual(user, body as never);
  }
}

@Controller('pm')
export class PmController {
  constructor(private readonly pm: PmService) {}

  @Post('generate')
  generate(@CurrentUser() user: SafeUser, @Body() body: PmGenerateDto) {
    return this.pm.generate(user, body?.upTo);
  }

  @Patch('records/:id')
  save(@CurrentUser() user: SafeUser, @Param('id') id: string, @Body() body: PmSaveDto) {
    return this.pm.save(user, id, body as never);
  }

  @Post('templates')
  createTemplate(@CurrentUser() user: SafeUser, @Body() body: PmTemplateDto) {
    return this.pm.saveTemplate(user, null, body as never);
  }

  @Patch('templates/:id')
  updateTemplate(@CurrentUser() user: SafeUser, @Param('id') id: string, @Body() body: PmTemplateDto) {
    return this.pm.saveTemplate(user, id, body as never);
  }
}

@Controller('dashboard')
export class DashboardController {
  constructor(private readonly dashboard: DashboardService) {}

  @Get()
  get(@CurrentUser() user: SafeUser) {
    return this.dashboard.get(user);
  }
}

@Controller('reports')
export class ReportsController {
  constructor(
    private readonly reports: ReportsService,
    private readonly access: AccessService,
  ) {}

  @Get(':name/pdf')
  async reportPdf(
    @CurrentUser() user: SafeUser,
    @Param('name') name: string,
    @Query() query: Record<string, string>,
    @Res() res: Response,
  ): Promise<void> {
    this.access.require(user, 'reports', 'view');
    const result = await this.reports.pdf(user, name, query?.['month']);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Length', String(result.buffer.length));
    res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(result.filename)}`);
    res.setHeader('Cache-Control', 'private, no-store');
    res.end(result.buffer);
  }

  @Get(':name')
  report(@CurrentUser() user: SafeUser, @Param('name') name: string, @Query() query: Record<string, string>) {
    this.access.require(user, 'reports', 'view');
    switch (name) {
      case 'tickets':
        return this.reports.tickets(user);
      case 'projects':
        return this.reports.projects(user);
      case 'service-contracts':
        return this.reports.serviceContracts(user);
      case 'revenue-share':
        return this.reports.revenueShare(user);
      case 'monthly-service':
        return this.reports.monthlyService(user, query?.['month']);
      case 'serials':
        return this.reports.serials(user);
      case 'stock':
        return this.reports.stockReport(user);
      case 'boq':
        return this.reports.boq(user);
      default:
        return { error: 'ไม่พบรายงานนี้' };
    }
  }
}
