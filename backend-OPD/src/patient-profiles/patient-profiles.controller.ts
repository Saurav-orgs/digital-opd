import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { PatientProfilesService } from './patient-profiles.service';
import {
  PatientDetailsDto,
  UpdatePatientProfileDto,
} from './dto/patient-profile.dto';
import { Public } from '../common/decorators/public.decorator';
import { CurrentUser, AuthUser } from '../common/decorators/current-user.decorator';
import { Permissions } from '../common/decorators/permissions.decorator';
import { PermissionAction, PermissionModule, UserType } from '../common/enums';
import { AppException } from '../common/errors/app.exception';
import { ErrorCode } from '../common/errors/error-codes';
import { PatientAuthGuard } from '../patient-auth/patient-auth.guard';
import {
  CurrentPatient,
  AuthPatient,
} from '../patient-auth/current-patient.decorator';

/**
 * Staff-side lookup: who is registered on a given number.
 *
 * Separate controller because it sits under the *admin* JWT guard, not the
 * patient one. The front desk needs this to pick the right family member when
 * booking a walk-in or filing a pathlab report.
 */
@ApiTags('Patient Profiles')
@ApiBearerAuth()
@Controller('patient-profiles')
export class StaffPatientProfilesController {
  constructor(private readonly service: PatientProfilesService) {}

  @Get('by-mobile')
  @ApiOperation({ summary: 'Patients registered on a mobile number' })
  @Permissions({
    module: PermissionModule.APPOINTMENTS,
    action: PermissionAction.READ,
  })
  async byMobile(@Query('mobile') mobile: string) {
    if (!/^[6-9]\d{9}$/.test(mobile ?? '')) return [];
    const account = await this.service.findAccount(mobile);
    return account ? this.service.listForAccount(account.id) : [];
  }

  @Get()
  @ApiOperation({ summary: 'Every patient this clinic has seen' })
  @Permissions({
    module: PermissionModule.PATIENTS,
    action: PermissionAction.READ,
  })
  async list(@CurrentUser() user: AuthUser, @Query('search') search?: string) {
    // A clinic's patient list is its own. An account with no doctor behind it
    // — the platform super admin — has no such list rather than everyone's.
    if (!user.doctorId) return [];
    return this.service.listForDoctor(user.doctorId, search);
  }

  @Get('for-doctor/:doctorId')
  @ApiOperation({ summary: "Super-admin: every patient one doctor's clinic has seen" })
  @Permissions({
    module: PermissionModule.PATIENTS,
    action: PermissionAction.READ,
  })
  async listForDoctor(
    @CurrentUser() user: AuthUser,
    @Param('doctorId', ParseUUIDPipe) doctorId: string,
    @Query('search') search?: string,
  ) {
    // Read-only, from the doctor's card on the Doctors screen. Clinic staff
    // reach their own list through `GET /patient-profiles`; only the platform
    // admin may name a doctor.
    if (user.type !== UserType.SUPER_ADMIN) {
      throw new AppException(ErrorCode.FORBIDDEN);
    }
    return this.service.listForDoctor(doctorId, search);
  }
}

/**
 * The people registered on the logged-in account. `@Public()` skips the global
 * admin JWT guard — `PatientAuthGuard` is the real gate.
 */
@ApiTags('Patient Profiles')
@ApiBearerAuth()
@Public()
@UseGuards(PatientAuthGuard)
@Controller('patient/profiles')
export class PatientProfilesController {
  constructor(private readonly service: PatientProfilesService) {}

  @Get()
  @ApiOperation({ summary: 'Everyone registered on this mobile number' })
  list(@CurrentPatient() patient: AuthPatient) {
    return this.service.listForAccount(patient.id);
  }

  @Post()
  @ApiOperation({
    summary:
      'Register another patient on this number. Always creates a new record — an identical name is not treated as a duplicate.',
  })
  create(
    @CurrentPatient() patient: AuthPatient,
    @Body() dto: PatientDetailsDto,
  ) {
    return this.service.createForAccount(patient.id, dto);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Edit one of this account’s patients' })
  update(
    @CurrentPatient() patient: AuthPatient,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdatePatientProfileDto,
  ) {
    return this.service.update(patient.id, id, dto);
  }

  @Delete(':id')
  @ApiOperation({
    summary:
      'Delete a patient added by mistake. Refused once any OPD has been completed.',
  })
  async remove(
    @CurrentPatient() patient: AuthPatient,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    await this.service.remove(patient.id, id);
    return { ok: true };
  }
}
