import { Controller, Get, Param, Res, StreamableFile } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { Response } from 'express';
import { PrescriptionsService } from './prescriptions.service';
import { Public } from '../common/decorators/public.decorator';
import { RawResponse } from '../common/decorators/raw-response.decorator';

/**
 * The prescription behind the link a doctor sends over WhatsApp.
 *
 * `@Public()` because the patient opens it from a chat with no session; the
 * token in the path is the whole credential (see `pdfByShareToken`). Rate
 * limited harder than the rest of the API since guessing is the only attack.
 */
@ApiTags('Public')
@Controller('rx')
export class PublicPrescriptionController {
  constructor(private readonly prescriptions: PrescriptionsService) {}

  @Public()
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @Get(':token')
  @ApiOperation({ summary: 'An issued prescription PDF, by the share token in a WhatsApp link' })
  @RawResponse()
  async open(
    @Param('token') token: string,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile> {
    const { buffer, filename } = await this.prescriptions.pdfByShareToken(token);
    res.set({
      'Content-Type': 'application/pdf',
      // `attachment`, not `inline`: tapped from WhatsApp, the phone saves the
      // PDF straight to its downloads rather than opening a browser tab the
      // patient then has to find the file behind.
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Content-Length': String(buffer.length),
      'Cache-Control': 'private, no-store',
    });
    return new StreamableFile(buffer);
  }
}
