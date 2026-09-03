import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
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
import { UpdateProgressSummaryDto } from './dto/update-progress-summary.dto';
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
      required: ['mobile', 'patient_profile_id', 'title', 'file'],
      properties: {
        mobile: { type: 'string', example: '9876543210' },
        patient_profile_id: { type: 'string', format: 'uuid' },
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

  @Post('appointment/:appointmentId')
  @ApiOperation({
    summary: "Clinic uploads a report against a specific visit",
  })
  // Gated on appointments:update, not reports:create — this is part of running
  // the consultation, and it is reached from the appointment screen.
  @Permissions({ module: PermissionModule.APPOINTMENTS, action: PermissionAction.UPDATE })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      required: ['title', 'file'],
      properties: {
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
  createForAppointment(
    @Param('appointmentId', ParseUUIDPipe) appointmentId: string,
    @Body('title') title: string,
    @UploadedFile() file: Express.Multer.File,
    @CurrentUser() user: AuthUser,
  ) {
    return this.service.createForAppointment(
      appointmentId,
      (title || '').trim() || 'Report',
      file,
      user,
    );
  }

  @Get()
  @ApiOperation({ summary: "One patient's reports, for admin/doctor viewing" })
  @Permissions({ module: PermissionModule.REPORTS, action: PermissionAction.READ })
  list(@Query('profileId') profileId: string, @CurrentUser() user: AuthUser) {
    if (!profileId) {
      throw new AppException(ErrorCode.BAD_REQUEST, {
        message: 'A patient is required.',
      });
    }
    return this.service.listForProfile(profileId, user.doctorId);
  }

  @Post(':id/summary/retry')
  @ApiOperation({
    summary: 'Re-run the AI summary for a report (after a failure)',
  })
  // Reached from the appointment screen, like the two retry routes below it,
  // so it is gated the same way. It used to require reports:read, which tied a
  // button on the consultation page to a module the clinic no longer has a
  // screen for.
  @Permissions({ module: PermissionModule.APPOINTMENTS, action: PermissionAction.READ })
  retrySummary(@Param('id', ParseUUIDPipe) id: string) {
    return this.summaries.retry(id);
  }

  @Patch('appointment/:appointmentId/progress')
  @ApiOperation({
    summary:
      "Save the doctor's corrected across-visits summary. The correction is also kept as training data.",
  })
  @Permissions({ module: PermissionModule.APPOINTMENTS, action: PermissionAction.UPDATE })
  saveProgress(
    @Param('appointmentId', ParseUUIDPipe) appointmentId: string,
    @Body() dto: UpdateProgressSummaryDto,
  ) {
    return this.summaries.saveProgressCorrection(appointmentId, {
      status: dto.status,
      summary: dto.summary,
      improvements: dto.improvements ?? [],
      deteriorations: dto.deteriorations ?? [],
      unchanged: dto.unchanged ?? [],
      trends: dto.trends ?? [],
      current_status: dto.current_status ?? '',
      watch_points: dto.watch_points ?? [],
    });
  }

  @Post('appointment/:appointmentId/progress/retry')
  @ApiOperation({
    summary:
      "Rebuild the across-visits summary — what changed since the patient's last visit",
  })
  @Permissions({ module: PermissionModule.APPOINTMENTS, action: PermissionAction.READ })
  retryProgress(@Param('appointmentId', ParseUUIDPipe) appointmentId: string) {
    return this.summaries.retryProgress(appointmentId);
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
