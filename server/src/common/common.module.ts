import { Global, Module } from '@nestjs/common';
import { AccessService } from './access.service.js';
import { ApprovalStoreService } from './approvals.service.js';
import { AuditService } from './audit.service.js';
import { CompanyController } from './company.controller.js';
import { CompanyService } from './company.service.js';
import { WorkspaceController } from './workspace.controller.js';
import { WorkspaceService } from './workspace.service.js';
import { WorkspacesController } from './workspaces.controller.js';
import { WorkspacesService } from './workspaces.service.js';

@Global()
@Module({
  controllers: [CompanyController, WorkspaceController, WorkspacesController],
  providers: [AccessService, AuditService, ApprovalStoreService, CompanyService, WorkspaceService, WorkspacesService],
  exports: [AccessService, AuditService, ApprovalStoreService, CompanyService, WorkspaceService, WorkspacesService],
})
export class CommonModule {}
