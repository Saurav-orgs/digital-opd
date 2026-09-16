import { Module } from '@nestjs/common';
import { SequelizeModule } from '@nestjs/sequelize';
import { BlockedNumber } from '../database/models/blocked-number.model';
import { Patient } from '../database/models/patient.model';
import { PatientProfile } from '../database/models/patient-profile.model';
import { User } from '../database/models/user.model';
import { BlockedNumbersService } from './blocked-numbers.service';
import { BlockedNumbersController } from './blocked-numbers.controller';

@Module({
  // The list names the people on each number, so it reads the patient
  // tables too — read-only; blocking never touches them.
  imports: [SequelizeModule.forFeature([BlockedNumber, Patient, PatientProfile, User])],
  controllers: [BlockedNumbersController],
  providers: [BlockedNumbersService],
  exports: [BlockedNumbersService],
})
export class BlockedNumbersModule {}
