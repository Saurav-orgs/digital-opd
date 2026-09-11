import { Module } from '@nestjs/common';
import { SequelizeModule } from '@nestjs/sequelize';
import { ConfigModule } from '@nestjs/config';
import { DoctorsService } from './doctors.service';
import { DoctorsController } from './doctors.controller';
import { Doctor } from '../database/models/doctor.model';
import { Permission } from '../database/models/permission.model';
import { Role } from '../database/models/role.model';
import { RolePermission } from '../database/models/role-permission.model';
import { User } from '../database/models/user.model';
import { OpdSchedule } from '../database/models/opd-schedule.model';
import { ScheduleException } from '../database/models/schedule-exception.model';

@Module({
  imports: [
    ConfigModule,
    SequelizeModule.forFeature([
      Doctor,
      Role,
      RolePermission,
      Permission,
      User,
      // Sign-up now writes the doctor's opening hours and any booked leave in
      // the same transaction as the account, so the tenant comes up bookable.
      OpdSchedule,
      ScheduleException,
    ]),
  ],
  controllers: [DoctorsController],
  providers: [DoctorsService],
  exports: [DoctorsService],
})
export class DoctorsModule {}
