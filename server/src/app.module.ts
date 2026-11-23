import 'dotenv/config';
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { DrizzleModule } from '@nestjs/drizzle';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { AppController } from './app.controller.js';
import { AppService } from './app.service.js';
import { AuthGuard } from './auth/auth.guard.js';
import { AuthModule } from './auth/auth.module.js';
import { BackupModule } from './backup/backup.module.js';
import { CommonModule } from './common/common.module.js';
import { DatabaseModule } from './db/database.module.js';
import { EventsModule } from './events/events.module.js';
import { FilesModule } from './files/files.module.js';
import { MetaModule } from './meta/meta.module.js';
import { NotifyModule } from './notify/notify.module.js';
import { OperationsModule } from './operations/operations.module.js';
import { PdfModule } from './pdf/pdf.module.js';
import { RecordsModule } from './records/records.module.js';
import { SearchModule } from './search/search.module.js';
import { WebhooksModule } from './webhooks/webhooks.module.js';
import { ViewsModule } from './views/views.module.js';
import { WorkspaceInterceptor } from './common/workspace.interceptor.js';

const dbPath = process.env.DATABASE_PATH ?? join(process.cwd(), 'data', 'sjp.sqlite');
mkdirSync(dirname(dbPath), { recursive: true });

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, envFilePath: ['.env'] }),
    ThrottlerModule.forRoot([{
      name: 'default',
      ttl: 60000,
      limit: Math.max(1, Number(process.env.THROTTLE_LIMIT) || 120),
    }]),
    DrizzleModule.forRoot({ drizzle, connection: dbPath }),
    DatabaseModule,
    EventsModule,
    CommonModule,
    AuthModule,
    RecordsModule,
    MetaModule,
    FilesModule,
    PdfModule,
    BackupModule,
    NotifyModule,
    WebhooksModule,
    SearchModule,
    OperationsModule,
    ViewsModule,
  ],
  controllers: [AppController],
  providers: [
    AppService,
    {
      provide: APP_GUARD,
      useClass: ThrottlerGuard,
    },
    {
      provide: APP_GUARD,
      useClass: AuthGuard,
    },
    {
      provide: APP_INTERCEPTOR,
      useClass: WorkspaceInterceptor,
    },
  ],
})
export class AppModule {}
