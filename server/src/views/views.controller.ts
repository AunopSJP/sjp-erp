import { Body, Controller, Delete, Get, Param, Post, Put, Query } from '@nestjs/common';
import { CurrentUser } from '../auth/current-user.decorator.js';
import type { SafeUser } from '../auth/user.types.js';
import { CreateViewDto, UpdateViewDto } from './views.dto.js';
import { ViewsService } from './views.service.js';

@Controller('views')
export class ViewsController {
  constructor(private readonly views: ViewsService) {}

  @Get()
  list(@CurrentUser() user: SafeUser, @Query('entity') entity: string) {
    return this.views.list(user, String(entity ?? ''));
  }

  @Post()
  create(@CurrentUser() user: SafeUser, @Body() body: CreateViewDto) {
    return this.views.create(user, { entity: body.entity, name: body.name, visibility: body.visibility, config: body.config });
  }

  @Put(':id')
  update(@CurrentUser() user: SafeUser, @Param('id') id: string, @Body() body: UpdateViewDto) {
    return this.views.update(user, id, { name: body.name, visibility: body.visibility, config: body.config });
  }

  @Delete(':id')
  remove(@CurrentUser() user: SafeUser, @Param('id') id: string) {
    return this.views.remove(user, id);
  }
}
