import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
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
  @ApiOperation({ summary: 'Book an appointment (payment happens in person)' })
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  book(@Body() dto: CreateAppointmentDto) {
    return this.appointments.book(dto, BookingSource.APP);
  }
}
