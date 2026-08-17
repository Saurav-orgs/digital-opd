import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { PatientAuthService } from './patient-auth.service';
import { PatientLoginDto } from './dto/patient-login.dto';
import { PatientRegisterDto } from './dto/patient-register.dto';
import { Public } from '../common/decorators/public.decorator';
import { PatientAuthGuard } from './patient-auth.guard';
import { CurrentPatient, AuthPatient } from './current-patient.decorator';

@ApiTags('Patient Auth')
@Public()
@Controller('patient/auth')
export class PatientAuthController {
  constructor(private readonly service: PatientAuthService) {}

  @Post('register')
  @ApiOperation({ summary: 'Register a patient by mobile + name (no password)' })
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
  @ApiOperation({ summary: 'Current authenticated patient' })
  me(@CurrentPatient() patient: AuthPatient) {
    return this.service.me(patient);
  }
}
