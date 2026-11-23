import { Module } from '@nestjs/common';
import { RecordsModule } from '../records/records.module.js';
import { PdfController } from './pdf.controller.js';
import { PdfService } from './pdf.service.js';

@Module({
  imports: [RecordsModule],
  controllers: [PdfController],
  providers: [PdfService],
  exports: [PdfService],
})
export class PdfModule {}
