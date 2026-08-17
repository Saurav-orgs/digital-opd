import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import {
  ApiBearerAuth,
  ApiBody,
  ApiConsumes,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { AppointmentsService } from '../appointments/appointments.service';
import { NotificationsService } from '../notifications/notifications.service';
import { ReportsService } from '../reports/reports.service';
import { CreateOwnReportDto } from '../reports/dto/create-own-report.dto';
import { Public } from '../common/decorators/public.decorator';
import { PatientAuthGuard } from '../patient-auth/patient-auth.guard';
import { CurrentPatient, AuthPatient } from '../patient-auth/current-patient.decorator';

/**
 * Everything a logged-in patient can see about themself, scoped to their own
 * mobile number. Marked `@Public()` to skip the global admin JWT guard —
 * `PatientAuthGuard` is the real gate here.
 */
@ApiTags('Patient Portal')
@ApiBearerAuth()
@Public()
@UseGuards(PatientAuthGuard)
@Controller('patient')
export class PatientPortalController {
  constructor(
    private readonly appointments: AppointmentsService,
    private readonly notifications: NotificationsService,
    private readonly reports: ReportsService,
  ) {}

  @Get('appointments')
  @ApiOperation({ summary: "Patient's consultation history (all visits by mobile)" })
  listAppointments(@CurrentPatient() patient: AuthPatient) {
    return this.appointments.patientVisits(patient.mobile);
  }

  @Get('reports')
  @ApiOperation({ summary: "Patient's reports (pathlab-uploaded and self-uploaded)" })
  listReports(@CurrentPatient() patient: AuthPatient) {
    return this.reports.listForMobile(patient.mobile);
  }

  @Post('reports')
  @ApiOperation({
    summary:
      "Patient uploads their own report — attaches to their most recently booked appointment",
  })
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
  uploadOwnReport(
    @Body() dto: CreateOwnReportDto,
    @UploadedFile() file: Express.Multer.File,
    @CurrentPatient() patient: AuthPatient,
  ) {
    return this.reports.createByPatient(patient, dto.title, file);
  }

  @Get('notifications')
  @ApiOperation({ summary: "Patient's notifications, newest first" })
  listNotifications(@CurrentPatient() patient: AuthPatient) {
    return this.notifications.listForPatient(patient.mobile);
  }

  @Get('notifications/unread-count')
  @ApiOperation({ summary: 'Count of unread notifications' })
  async unreadCount(@CurrentPatient() patient: AuthPatient) {
    return { count: await this.notifications.unreadCount(patient.mobile) };
  }

  @Patch('notifications/:id/read')
  @ApiOperation({ summary: 'Mark one notification as read' })
  async markRead(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentPatient() patient: AuthPatient,
  ) {
    await this.notifications.markRead(patient.mobile, id);
    return { ok: true };
  }

  @Patch('notifications/read-all')
  @ApiOperation({ summary: 'Mark all notifications as read' })
  async markAllRead(@CurrentPatient() patient: AuthPatient) {
    await this.notifications.markAllRead(patient.mobile);
    return { ok: true };
  }
}
