import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { PatientAuthService } from './patient-auth.service';
import { PatientLoginDto } from './dto/patient-login.dto';
import { PatientRegisterDto } from './dto/patient-register.dto';
import { PatientCheckDto } from './dto/patient-check.dto';
import { PatientSignupDto } from './dto/patient-signup.dto';
import { Public } from '../common/decorators/public.decorator';
import { PatientAuthGuard } from './patient-auth.guard';
import { CurrentPatient, AuthPatient } from './current-patient.decorator';

@ApiTags('Patient Auth')
@Public()
@Controller('patient/auth')
export class PatientAuthController {
  constructor(private readonly service: PatientAuthService) {}

  @Post('check')
  // Answers whether a number is registered, so it stays stricter than the
  // global limit — enumerating numbers should be slow and obvious.
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @ApiOperation({
    summary:
      'Step 1 — does this number have an account, and has it set a password? Grants nothing.',
  })
  check(@Body() dto: PatientCheckDto) {
    return this.service.check(dto);
  }

  @Post('signup')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @ApiOperation({
    summary:
      'Open an account with a number and a password (no patient details — booking asks next)',
  })
  signup(@Body() dto: PatientSignupDto) {
    return this.service.signup(dto);
  }

  @Post('register')
  @ApiOperation({
    summary:
      'Register: the number becomes the account, the password secures it, the details become one patient on it',
  })
  register(@Body() dto: PatientRegisterDto) {
    return this.service.register(dto);
  }

  @Post('login')
  // Password guessing is the attack this rate limit exists for.
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @ApiOperation({ summary: 'Sign in with mobile number and password' })
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
