import { Module } from '@nestjs/common';
import { SequelizeModule } from '@nestjs/sequelize';
import { OpdSchedulesService } from './opd-schedules.service';
import { OpdSchedulesController } from './opd-schedules.controller';
import { OpdSchedule } from '../database/models/opd-schedule.model';
import { ScheduleException } from '../database/models/schedule-exception.model';
import { Appointment } from '../database/models/appointment.model';
import { Doctor } from '../database/models/doctor.model';
import { SlotsModule } from '../slots/slots.module';

@Module({
  imports: [
    SequelizeModule.forFeature([
      OpdSchedule,
      ScheduleException,
      Appointment,
      Doctor,
    ]),
    SlotsModule,
  ],
  controllers: [OpdSchedulesController],
  providers: [OpdSchedulesService],
  exports: [OpdSchedulesService],
})
export class OpdSchedulesModule {}
