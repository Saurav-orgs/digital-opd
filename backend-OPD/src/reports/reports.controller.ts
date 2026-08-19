import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { ApiBearerAuth, ApiBody, ApiConsumes, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ReportsService } from './reports.service';
import { ReportSummaryService } from './report-summary.service';
import { CreateReportDto } from './dto/create-report.dto';
import { Permissions } from '../common/decorators/permissions.decorator';
import { PermissionAction, PermissionModule } from '../common/enums';
import { CurrentUser, AuthUser } from '../common/decorators/current-user.decorator';
import { AppException } from '../common/errors/app.exception';
import { ErrorCode } from '../common/errors/error-codes';

@ApiTags('Reports')
@ApiBearerAuth()
@Controller('reports')
export class ReportsController {
  constructor(
    private readonly service: ReportsService,
    private readonly summaries: ReportSummaryService,
  ) {}

  @Post()
  @ApiOperation({ summary: 'Pathlab uploads a report for a patient (by mobile)' })
  @Permissions({ module: PermissionModule.REPORTS, action: PermissionAction.CREATE })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      required: ['mobile', 'title', 'file'],
      properties: {
        mobile: { type: 'string', example: '9876543210' },
        title: { type: 'string', example: 'Blood Test — CBC' },
        file: { type: 'string', format: 'binary' },
      },
    },
  })
  @UseInterceptors(
    FileInterceptor('file', {
      storage: memoryStorage(),
      limits: { fileSize: 6 * 1024 * 1024 },
    }),
  )
  create(
    @Body() dto: CreateReportDto,
    @UploadedFile() file: Express.Multer.File,
    @CurrentUser() user: AuthUser,
  ) {
    return this.service.create(dto, file, user);
  }

  @Get()
  @ApiOperation({ summary: "A patient's reports, for admin/doctor viewing" })
  @Permissions({ module: PermissionModule.REPORTS, action: PermissionAction.READ })
  list(@Query('mobile') mobile: string) {
    if (!mobile) {
      throw new AppException(ErrorCode.BAD_REQUEST, {
        message: 'A mobile number is required.',
      });
    }
    return this.service.listForMobile(mobile);
  }

  @Post(':id/summary/retry')
  @ApiOperation({
    summary: 'Re-run the AI summary for a report (after a failure)',
  })
  @Permissions({ module: PermissionModule.REPORTS, action: PermissionAction.READ })
  retrySummary(@Param('id', ParseUUIDPipe) id: string) {
    return this.summaries.retry(id);
  }

  @Post('appointment/:appointmentId/summary/retry')
  @ApiOperation({
    summary: "Rebuild the combined summary of a visit's reports",
  })
  @Permissions({ module: PermissionModule.APPOINTMENTS, action: PermissionAction.READ })
  retryConsolidation(@Param('appointmentId', ParseUUIDPipe) appointmentId: string) {
    return this.summaries.retryConsolidation(appointmentId);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Delete a report' })
  @Permissions({ module: PermissionModule.REPORTS, action: PermissionAction.CREATE })
  remove(@Param('id', ParseUUIDPipe) id: string) {
    return this.service.remove(id);
  }
}
