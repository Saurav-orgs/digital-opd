import { Global, Module } from '@nestjs/common';
import { SequelizeModule } from '@nestjs/sequelize';
import { AppSetting } from '../database/models/app-setting.model';
import { SettingsService } from './settings.service';
import { SettingsController } from './settings.controller';

/**
 * Global so any module can resolve the patient portal's base URL without
 * importing this one — doctors, prescriptions and notifications all build
 * patient-facing links.
 */
@Global()
@Module({
  imports: [SequelizeModule.forFeature([AppSetting])],
  providers: [SettingsService],
  controllers: [SettingsController],
  exports: [SettingsService],
})
export class SettingsModule {}
