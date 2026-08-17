import {
  Body,
  Controller,
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
import { Throttle } from '@nestjs/throttler';
import {
  ApiBody,
  ApiConsumes,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { AppointmentsService } from './appointments.service';
import { CreateAppointmentDto } from './dto/create-appointment.dto';
import { DoctorsService } from '../doctors/doctors.service';
import { SlotsService } from '../slots/slots.service';
import { Public } from '../common/decorators/public.decorator';
import { BookingSource } from '../common/enums';
import { AppException } from '../common/errors/app.exception';
import { ErrorCode } from '../common/errors/error-codes';

@ApiTags('Public (patient app)')
@Public()
@Controller('public')
export class PublicController {
  constructor(
    private readonly appointments: AppointmentsService,
    private readonly doctors: DoctorsService,
    private readonly slots: SlotsService,
  ) {}

  @Get('doctors')
  @ApiOperation({ summary: 'List enabled doctors' })
  listDoctors() {
    return this.doctors.listEnabled();
  }

  @Get('doctors/:slug')
  @ApiOperation({ summary: 'Enabled doctor by public slug' })
  doctorBySlug(@Param('slug') slug: string) {
    return this.doctors.findEnabledBySlug(slug);
  }

  @Get('doctors/:id/slots')
  @ApiOperation({ summary: 'Slot grid for a doctor on a date' })
  async slotsForDate(
    @Param('id', ParseUUIDPipe) id: string,
    @Query('date') date: string,
  ) {
    if (!date) {
      throw new AppException(ErrorCode.BAD_REQUEST, {
        message: 'A date (YYYY-MM-DD) is required.',
      });
    }
    // Ensure the doctor is enabled before exposing availability.
    await this.doctors.findEnabledById(id);
    return this.slots.getDaySlots(id, date);
  }

  @Post('appointments')
  @ApiOperation({ summary: 'Book an appointment (multipart: fields + screenshot)' })
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      required: [
        'doctor_id',
        'appointment_date',
        'start_time',
        'patient_name',
        'patient_mobile',
        'patient_gender',
        'patient_age',
        'screenshot',
      ],
      properties: {
        doctor_id: { type: 'string', format: 'uuid' },
        appointment_date: { type: 'string', example: '2026-07-28' },
        start_time: { type: 'string', example: '11:30' },
        patient_name: { type: 'string' },
        patient_mobile: { type: 'string', example: '9876543210' },
        patient_gender: { type: 'string', enum: ['male', 'female', 'other'] },
        patient_age: { type: 'integer', example: 34 },
        patient_address: { type: 'string' },
        description: { type: 'string' },
        screenshot: { type: 'string', format: 'binary' },
      },
    },
  })
  @UseInterceptors(
    FileInterceptor('screenshot', {
      storage: memoryStorage(),
      limits: { fileSize: 6 * 1024 * 1024 },
    }),
  )
  book(
    @Body() dto: CreateAppointmentDto,
    @UploadedFile() screenshot: Express.Multer.File,
  ) {
    return this.appointments.book(dto, screenshot, BookingSource.APP);
  }
}
