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
  UploadedFiles,
  UseInterceptors,
} from '@nestjs/common';
import { FilesInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import {
  ApiBearerAuth,
  ApiBody,
  ApiConsumes,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { AppointmentsService } from './appointments.service';
import {
  AppointmentNotesDto,
  ConsultationDto,
  ListAppointmentsQueryDto,
} from './dto/manage-appointment.dto';
import { WalkInAppointmentDto } from './dto/walkin-appointment.dto';
import { RescheduleDto } from './dto/reschedule.dto';
import { ReminderDto } from './dto/reminder.dto';
import { Permissions } from '../common/decorators/permissions.decorator';
import { PermissionAction, PermissionModule } from '../common/enums';
import { CurrentUser, AuthUser } from '../common/decorators/current-user.decorator';
import { AppException } from '../common/errors/app.exception';
import { ErrorCode } from '../common/errors/error-codes';

@ApiTags('Appointments')
@ApiBearerAuth()
@Controller('appointments')
export class AppointmentsController {
  constructor(private readonly service: AppointmentsService) {}

  @Get()
  @ApiOperation({ summary: 'List appointments (doctors see only their own)' })
  @Permissions({ module: PermissionModule.APPOINTMENTS, action: PermissionAction.READ })
  list(
    @Query() query: ListAppointmentsQueryDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.service.list(query, user);
  }

  @Get('history')
  @ApiOperation({ summary: "A patient's prior visits (matched by mobile)" })
  @Permissions({ module: PermissionModule.APPOINTMENTS, action: PermissionAction.READ })
  history(
    @Query('mobile') mobile: string,
    @Query('excludeId') excludeId: string | undefined,
    @CurrentUser() user: AuthUser,
  ) {
    if (!mobile) {
      throw new AppException(ErrorCode.BAD_REQUEST, {
        message: 'A mobile number is required.',
      });
    }
    return this.service.history(mobile, user, excludeId);
  }

  @Post('walk-in')
  @ApiOperation({ summary: 'Doctor books an in-clinic walk-in' })
  @Permissions({ module: PermissionModule.APPOINTMENTS, action: PermissionAction.CREATE })
  bookWalkIn(
    @Body() dto: WalkInAppointmentDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.service.bookWalkIn(dto, user);
  }

  @Get(':id')
  @Permissions({ module: PermissionModule.APPOINTMENTS, action: PermissionAction.READ })
  findOne(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthUser,
  ) {
    return this.service.findOne(id, user);
  }

  @Patch(':id/consultation')
  @ApiOperation({ summary: 'Doctor marks visit done / on_hold / rejected' })
  @Permissions({ module: PermissionModule.APPOINTMENTS, action: PermissionAction.UPDATE })
  setConsultation(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ConsultationDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.service.setConsultation(id, dto, user);
  }

  @Patch(':id/reschedule')
  @ApiOperation({ summary: 'Move the appointment to another available slot' })
  @Permissions({ module: PermissionModule.APPOINTMENTS, action: PermissionAction.UPDATE })
  reschedule(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: RescheduleDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.service.reschedule(id, dto, user);
  }

  @Patch(':id/notes')
  @ApiOperation({ summary: "Save the doctor's note for a visit" })
  @Permissions({ module: PermissionModule.APPOINTMENTS, action: PermissionAction.UPDATE })
  setNotes(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AppointmentNotesDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.service.setNotes(id, dto, user);
  }

  @Post(':id/reminder')
  @ApiOperation({ summary: "Doctor sets a reminder for the patient's next visit" })
  @Permissions({ module: PermissionModule.APPOINTMENTS, action: PermissionAction.UPDATE })
  addReminder(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ReminderDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.service.addReminder(id, dto, user);
  }

  @Post(':id/prescriptions')
  @ApiOperation({ summary: 'Upload one or more prescription images' })
  @Permissions({ module: PermissionModule.APPOINTMENTS, action: PermissionAction.UPDATE })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      required: ['images'],
      properties: {
        images: {
          type: 'array',
          items: { type: 'string', format: 'binary' },
        },
      },
    },
  })
  @UseInterceptors(
    FilesInterceptor('images', 10, {
      storage: memoryStorage(),
      limits: { fileSize: 6 * 1024 * 1024 },
    }),
  )
  addPrescriptions(
    @Param('id', ParseUUIDPipe) id: string,
    @UploadedFiles() images: Express.Multer.File[],
    @CurrentUser() user: AuthUser,
  ) {
    return this.service.addPrescriptions(id, images, user);
  }

  @Delete(':id/prescriptions/:prescriptionId')
  @ApiOperation({ summary: 'Delete a prescription image' })
  @Permissions({ module: PermissionModule.APPOINTMENTS, action: PermissionAction.UPDATE })
  deletePrescription(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('prescriptionId', ParseUUIDPipe) prescriptionId: string,
    @CurrentUser() user: AuthUser,
  ) {
    return this.service.deletePrescription(id, prescriptionId, user);
  }
}
