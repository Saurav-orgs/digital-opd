import { Module } from '@nestjs/common';
import { SequelizeModule } from '@nestjs/sequelize';
import { DashboardService } from './dashboard.service';
import { DashboardController } from './dashboard.controller';
import { Appointment } from '../database/models/appointment.model';
import { Doctor } from '../database/models/doctor.model';

@Module({
  imports: [SequelizeModule.forFeature([Appointment, Doctor])],
  controllers: [DashboardController],
  providers: [DashboardService],
})
export class DashboardModule {}
