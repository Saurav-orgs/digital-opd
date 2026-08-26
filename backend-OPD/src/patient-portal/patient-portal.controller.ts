import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
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
import { PatientProfilesService } from '../patient-profiles/patient-profiles.service';
import { CreateOwnReportDto } from '../reports/dto/create-own-report.dto';
import { UpdateOwnReportDto } from '../reports/dto/update-own-report.dto';
import { Public } from '../common/decorators/public.decorator';
import { AppException } from '../common/errors/app.exception';
import { ErrorCode } from '../common/errors/error-codes';
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
    private readonly profiles: PatientProfilesService,
  ) {}

  @Get('appointments')
  @ApiOperation({
    summary:
      "One patient's visits. `profile_id` is required — an account may cover a whole family.",
  })
  async listAppointments(
    @CurrentPatient() patient: AuthPatient,
    @Query('profile_id') profileId: string,
    @Query('doctor_id') doctorId?: string,
  ) {
    await this.assertOwnPatient(patient, profileId);
    return this.appointments.patientVisits(profileId, doctorId ?? null);
  }

  @Get('reports')
  @ApiOperation({ summary: "One patient's reports, optionally scoped to one doctor" })
  async listReports(
    @CurrentPatient() patient: AuthPatient,
    @Query('profile_id') profileId: string,
    @Query('doctor_id') doctorId?: string,
  ) {
    await this.assertOwnPatient(patient, profileId);
    return this.reports.listForProfile(profileId, doctorId ?? null);
  }

  @Delete('appointments/:id')
  @ApiOperation({
    summary:
      'Cancel a booking — the fix for booking under the wrong family member. Refused once the doctor has started on the visit.',
  })
  async cancelAppointment(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentPatient() patient: AuthPatient,
  ) {
    const mine = await this.profiles.listForAccount(patient.id);
    await this.appointments.cancel(id, { profileIds: mine.map((p) => p.id) });
    return { ok: true };
  }

  @Post('appointments/:id/reports')
  @ApiOperation({
    summary:
      'Patient uploads a report against one of their appointments (allowed until the visit is marked done)',
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
    @Param('id', ParseUUIDPipe) appointmentId: string,
    @Body() dto: CreateOwnReportDto,
    @UploadedFile() file: Express.Multer.File,
    @CurrentPatient() patient: AuthPatient,
  ) {
    return this.reports.createByPatient(patient, appointmentId, dto.title, file);
  }

  @Patch('reports/:id')
  @ApiOperation({
    summary:
      'Patient edits their own report — rename it and/or replace the file (allowed until the visit is marked done)',
  })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        title: { type: 'string', example: 'Blood Test — CBC (repeat)' },
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
  updateOwnReport(
    @Param('id', ParseUUIDPipe) reportId: string,
    @Body() dto: UpdateOwnReportDto,
    @UploadedFile() file: Express.Multer.File | undefined,
    @CurrentPatient() patient: AuthPatient,
  ) {
    return this.reports.updateByPatient(patient, reportId, dto.title, file);
  }

  @Delete('reports/:id')
  @ApiOperation({
    summary:
      'Patient deletes their own report (allowed until the visit is marked done)',
  })
  async deleteOwnReport(
    @Param('id', ParseUUIDPipe) reportId: string,
    @CurrentPatient() patient: AuthPatient,
  ) {
    await this.reports.removeByPatient(patient, reportId);
    return { ok: true };
  }

  @Get('notifications')
  @ApiOperation({
    summary:
      "Account's notifications. Pass `profile_id` to narrow to one patient; omit it for the whole family's feed.",
  })
  async listNotifications(
    @CurrentPatient() patient: AuthPatient,
    @Query('doctor_id') doctorId?: string,
    @Query('profile_id') profileId?: string,
  ) {
    if (profileId) await this.assertOwnPatient(patient, profileId);
    return this.notifications.listForPatient(
      patient.mobile,
      doctorId ?? null,
      profileId ?? null,
    );
  }

  @Get('notifications/unread-count')
  @ApiOperation({ summary: 'Count of unread notifications' })
  async unreadCount(
    @CurrentPatient() patient: AuthPatient,
    @Query('doctor_id') doctorId?: string,
  ) {
    return { count: await this.notifications.unreadCount(patient.mobile, doctorId ?? null) };
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

  /**
   * Every `profile_id` arriving from the client is checked against the logged-in
   * account before it reaches a query. Without this, one number could read
   * another number's patients simply by guessing an id.
   */
  private async assertOwnPatient(patient: AuthPatient, profileId: string) {
    if (!profileId) {
      throw new AppException(ErrorCode.BAD_REQUEST, {
        message: 'Please choose which patient to view.',
      });
    }
    await this.profiles.assertOwned(patient.id, profileId);
  }

  @Patch('notifications/read-all')
  @ApiOperation({ summary: 'Mark all notifications as read' })
  async markAllRead(@CurrentPatient() patient: AuthPatient) {
    await this.notifications.markAllRead(patient.mobile);
    return { ok: true };
  }
}
