import { Module } from '@nestjs/common';
import { ViewsController } from './views.controller.js';
import { ViewsService } from './views.service.js';

@Module({
  controllers: [ViewsController],
  providers: [ViewsService],
  exports: [ViewsService],
})
export class ViewsModule {}
