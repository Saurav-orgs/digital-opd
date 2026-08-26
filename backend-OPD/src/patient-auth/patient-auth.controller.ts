import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { PatientAuthService } from './patient-auth.service';
import { PatientLoginDto } from './dto/patient-login.dto';
import { PatientRegisterDto } from './dto/patient-register.dto';
import { PatientIdentifyDto } from './dto/patient-identify.dto';
import { Public } from '../common/decorators/public.decorator';
import { PatientAuthGuard } from './patient-auth.guard';
import { CurrentPatient, AuthPatient } from './current-patient.decorator';

@ApiTags('Patient Auth')
@Public()
@Controller('patient/auth')
export class PatientAuthController {
  constructor(private readonly service: PatientAuthService) {}

  @Post('identify')
  // Returns everyone registered on a number, so it is deliberately stricter
  // than the global limit — enumerating numbers should be slow and obvious.
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @ApiOperation({
    summary:
      'Booking step 1 — the mobile number. Creates the account if new and returns the patients already registered on it.',
  })
  identify(@Body() dto: PatientIdentifyDto) {
    return this.service.identify(dto);
  }

  @Post('register')
  @ApiOperation({
    summary:
      'Register: the number becomes the account, the details become one patient on it',
  })
  register(@Body() dto: PatientRegisterDto) {
    return this.service.register(dto);
  }

  @Post('login')
  @ApiOperation({ summary: 'Login by mobile number only (no password/OTP)' })
  login(@Body() dto: PatientLoginDto) {
    return this.service.login(dto);
  }

  @Get('me')
  @ApiBearerAuth()
  @UseGuards(PatientAuthGuard)
  @ApiOperation({ summary: 'Current account and the patients registered on it' })
  me(@CurrentPatient() patient: AuthPatient) {
    return this.service.me(patient);
  }
}
