import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { ValidationPipe, VersioningType } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { Logger } from 'nestjs-pino';
import { AppModule } from './app.module';
import { validationExceptionFactory } from './common/validation/validation.factory';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { bufferLogs: true });
  const config = app.get(ConfigService);

  app.useLogger(app.get(Logger));

  const prefix = config.get<string>('apiPrefix') ?? 'api';
  app.setGlobalPrefix(prefix);

  app.enableCors({ origin: true, credentials: true });

  // Uniform validation → 422 VALIDATION_FAILED with per-field, readable messages.
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: true },
      exceptionFactory: validationExceptionFactory,
    }),
  );

  // ── Swagger ────────────────────────────────────────────────
  const swaggerConfig = new DocumentBuilder()
    .setTitle('OPD Appointment API')
    .setDescription(
      'Doctor OPD appointment booking system. All responses use a consistent ' +
        'envelope; errors carry a stable `error` code + a user-facing `message`.',
    )
    .setVersion('0.1.0')
    .addBearerAuth()
    .addTag('Auth')
    .addTag('Users')
    .addTag('Roles & Permissions')
    .addTag('Doctors')
    .addTag('OPD Schedules')
    .addTag('Appointments')
    .addTag('Public (patient app)')
    .addTag('Dashboard')
    .addTag('Health')
    .build();
  const document = SwaggerModule.createDocument(app, swaggerConfig);
  SwaggerModule.setup(`${prefix}/docs`, app, document, {
    swaggerOptions: { persistAuthorization: true },
  });

  const port = config.get<number>('port') ?? 3000;
  await app.listen(port);
  const logger = app.get(Logger);
  logger.log(`OPD API listening on http://localhost:${port}/${prefix}`);
  logger.log(`Swagger docs at http://localhost:${port}/${prefix}/docs`);
}

bootstrap();
