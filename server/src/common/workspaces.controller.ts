import { Body, Controller, Get, Param, Post, Put } from '@nestjs/common';
import { CurrentUser } from '../auth/current-user.decorator.js';
import type { SafeUser } from '../auth/user.types.js';
import { CreateWorkspaceDto, SetActiveWorkspaceDto, SetWorkspaceMembersDto, UpdateWorkspaceDto } from './workspaces.dto.js';
import { WorkspacesService } from './workspaces.service.js';

@Controller('workspaces')
export class WorkspacesController {
  constructor(private readonly workspaces: WorkspacesService) {}

  @Get()
  list(@CurrentUser() user: SafeUser) {
    return this.workspaces.list(user);
  }

  @Post()
  create(@CurrentUser() user: SafeUser, @Body() body: CreateWorkspaceDto) {
    return this.workspaces.create(user, { id: body.id, name: body.name });
  }

  @Put(':id')
  update(
    @CurrentUser() user: SafeUser,
    @Param('id') id: string,
    @Body() body: UpdateWorkspaceDto,
  ) {
    return this.workspaces.update(user, id, { name: body.name, archived: body.archived });
  }

  @Post('active')
  setActive(@CurrentUser() user: SafeUser, @Body() body: SetActiveWorkspaceDto) {
    return this.workspaces.setActive(user, body.id);
  }

  @Get(':id/members')
  members(@CurrentUser() user: SafeUser, @Param('id') id: string) {
    return this.workspaces.members(user, id);
  }

  @Put(':id/members')
  setMembers(
    @CurrentUser() user: SafeUser,
    @Param('id') id: string,
    @Body() body: SetWorkspaceMembersDto,
  ) {
    return this.workspaces.setMembers(user, id, body.userIds);
  }
}
