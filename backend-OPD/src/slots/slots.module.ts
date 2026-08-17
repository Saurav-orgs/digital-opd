import { Module } from '@nestjs/common';
import { SequelizeModule } from '@nestjs/sequelize';
import { SlotsService } from './slots.service';
import { OpdSchedule } from '../database/models/opd-schedule.model';
import { ScheduleException } from '../database/models/schedule-exception.model';
import { Appointment } from '../database/models/appointment.model';

@Module({
  imports: [
    SequelizeModule.forFeature([OpdSchedule, ScheduleException, Appointment]),
  ],
  providers: [SlotsService],
  exports: [SlotsService],
})
export class SlotsModule {}
