import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { SequelizeModule } from '@nestjs/sequelize';
import { Patient } from '../database/models/patient.model';
import { PatientProfilesModule } from '../patient-profiles/patient-profiles.module';
import { PatientAuthService } from './patient-auth.service';
import { PatientAuthController } from './patient-auth.controller';
import { PatientStrategy } from './patient.strategy';
import { PatientAuthGuard } from './patient-auth.guard';

@Module({
  imports: [
    SequelizeModule.forFeature([Patient]),
    PatientProfilesModule,
    PassportModule,
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        secret: config.get('jwt').secret,
        signOptions: { expiresIn: config.get('jwt').expiresIn },
      }),
    }),
  ],
  controllers: [PatientAuthController],
  providers: [PatientAuthService, PatientStrategy, PatientAuthGuard],
  exports: [PatientAuthGuard],
})
export class PatientAuthModule {}
