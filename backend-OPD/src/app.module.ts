import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR, Reflector } from '@nestjs/core';
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler';
import { LoggerModule } from 'nestjs-pino';
import configuration from './config/configuration';
import { DatabaseModule } from './database/database.module';
import { MasterSetupModule } from './bootstrap/master-setup.module';
import { UploadsModule } from './uploads/uploads.module';
import { AiModule } from './ai/ai.module';
import { AuthModule } from './auth/auth.module';
import { UsersModule } from './users/users.module';
import { RolesModule } from './roles/roles.module';
import { DoctorsModule } from './doctors/doctors.module';
import { OpdSchedulesModule } from './opd-schedules/opd-schedules.module';
import { SlotsModule } from './slots/slots.module';
import { AppointmentsModule } from './appointments/appointments.module';
import { DashboardModule } from './dashboard/dashboard.module';
import { PatientAuthModule } from './patient-auth/patient-auth.module';
import { PatientProfilesModule } from './patient-profiles/patient-profiles.module';
import { PatientPortalModule } from './patient-portal/patient-portal.module';
import { NotificationsModule } from './notifications/notifications.module';
import { ReportsModule } from './reports/reports.module';
import { PathlabsModule } from './pathlabs/pathlabs.module';
import { MedicinesModule } from './medicines/medicines.module';
import { ConsultationsModule } from './consultations/consultations.module';
import { HealthController } from './health/health.controller';
import { JwtAuthGuard } from './common/guards/jwt-auth.guard';
import { PermissionsGuard } from './common/guards/permissions.guard';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';
import { TransformInterceptor } from './common/interceptors/transform.interceptor';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: [configuration],
    }),
    LoggerModule.forRoot({
      pinoHttp: {
        transport:
          process.env.NODE_ENV !== 'production'
            ? { target: 'pino-pretty', options: { singleLine: true } }
            : undefined,
        autoLogging: false,
        redact: ['req.headers.authorization'],
      },
    }),
    ThrottlerModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => [
        {
          ttl: config.get('throttle').ttl * 1000,
          limit: config.get('throttle').limit,
        },
      ],
    }),
    DatabaseModule,
    // Ensures a full-access SuperAdmin login exists on every start (see
    // MasterSetupService) — before the request-handling modules below.
    MasterSetupModule,
    UploadsModule,
    // Global: the local inference sidecar is used by reports and consultations.
    AiModule,
    AuthModule,
    UsersModule,
    RolesModule,
    DoctorsModule,
    OpdSchedulesModule,
    SlotsModule,
    AppointmentsModule,
    DashboardModule,
    NotificationsModule,
    PatientProfilesModule,
    PatientAuthModule,
    PatientPortalModule,
    ReportsModule,
    PathlabsModule,
    MedicinesModule,
    ConsultationsModule,
  ],
  controllers: [HealthController],
  providers: [
    // Order matters: throttle → authenticate → authorize.
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: PermissionsGuard },
    { provide: APP_INTERCEPTOR, useClass: TransformInterceptor },
    { provide: APP_FILTER, useClass: AllExceptionsFilter },
    Reflector,
  ],
})
export class AppModule {}
