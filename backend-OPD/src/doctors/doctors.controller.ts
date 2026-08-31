import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Res,
  StreamableFile,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import { memoryStorage } from 'multer';
import {
  ApiBearerAuth,
  ApiBody,
  ApiConsumes,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { ConfigService } from '@nestjs/config';
import { SettingsService } from '../settings/settings.service';
import { DoctorsService } from './doctors.service';
import { CreateDoctorDto, UpdateDoctorDto, UpdateOwnDoctorDto } from './dto/doctor.dto';
import { ResetDoctorPasswordDto } from './dto/reset-doctor-password.dto';
import { RegisterDoctorDto, RejectDoctorDto } from './dto/register-doctor.dto';
import { Public } from '../common/decorators/public.decorator';
import { RawResponse } from '../common/decorators/raw-response.decorator';
import { Permissions } from '../common/decorators/permissions.decorator';
import { PermissionAction, PermissionModule, UserType } from '../common/enums';
import { CurrentUser, AuthUser } from '../common/decorators/current-user.decorator';
import { AppException } from '../common/errors/app.exception';
import { ErrorCode } from '../common/errors/error-codes';

const imageUpload = {
  storage: memoryStorage(),
  // Hard cap so oversized uploads are rejected before buffering everything.
  limits: { fileSize: 6 * 1024 * 1024 },
};

const fileBody = {
  schema: {
    type: 'object',
    properties: { file: { type: 'string', format: 'binary' } },
  },
};

@ApiTags('Doctors')
@ApiBearerAuth()
@Controller('doctors')
export class DoctorsController {
  constructor(
    private readonly doctorsService: DoctorsService,
    private readonly config: ConfigService,
    private readonly settings: SettingsService,
  ) {}

  // ── Doctor self-service (declared before :id) ──────────────
  @Get('me')
  @ApiOperation({ summary: 'Logged-in doctor’s own profile' })
  getOwn(@CurrentUser() user: AuthUser) {
    return this.doctorsService.findOne(this.selfId(user));
  }

  @Patch('me')
  @ApiOperation({ summary: 'Doctor updates own profile (needs doctors:update)' })
  @Permissions({ module: PermissionModule.DOCTORS, action: PermissionAction.UPDATE })
  updateOwn(@CurrentUser() user: AuthUser, @Body() dto: UpdateOwnDoctorDto) {
    return this.doctorsService.update(this.selfId(user), dto);
  }

  @Post('me/photo')
  @ApiOperation({ summary: 'Doctor uploads own profile photo' })
  @Permissions({ module: PermissionModule.DOCTORS, action: PermissionAction.UPDATE })
  @ApiConsumes('multipart/form-data')
  @ApiBody(fileBody)
  @UseInterceptors(FileInterceptor('file', imageUpload))
  uploadOwnPhoto(
    @CurrentUser() user: AuthUser,
    @UploadedFile() file: Express.Multer.File,
  ) {
    return this.doctorsService.uploadPhoto(this.selfId(user), file);
  }

  @Post('me/letterhead-logo')
  @ApiOperation({ summary: 'Doctor uploads own prescription letterhead logo' })
  @Permissions({ module: PermissionModule.DOCTORS, action: PermissionAction.UPDATE })
  @ApiConsumes('multipart/form-data')
  @ApiBody(fileBody)
  @UseInterceptors(FileInterceptor('file', imageUpload))
  uploadOwnLetterheadLogo(
    @CurrentUser() user: AuthUser,
    @UploadedFile() file: Express.Multer.File,
  ) {
    return this.doctorsService.uploadLetterheadLogo(this.selfId(user), file);
  }

  @Post('me/qr')
  @ApiOperation({ summary: 'Doctor uploads own profile QR code image' })
  @Permissions({ module: PermissionModule.DOCTORS, action: PermissionAction.UPDATE })
  @ApiConsumes('multipart/form-data')
  @ApiBody(fileBody)
  @UseInterceptors(FileInterceptor('file', imageUpload))
  uploadOwnQr(
    @CurrentUser() user: AuthUser,
    @UploadedFile() file: Express.Multer.File,
  ) {
    return this.doctorsService.uploadQr(this.selfId(user), file);
  }

  @Get('me/qr')
  @ApiOperation({
    summary: 'Doctor’s own QR image bytes, for download or native share',
  })
  @RawResponse()
  async ownQrFile(
    @CurrentUser() user: AuthUser,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile> {
    const { buffer, filename } = await this.doctorsService.qrFile(this.selfId(user));
    res.set({
      'Content-Type': 'image/png',
      'Content-Disposition': `inline; filename="${filename}"`,
      'Access-Control-Expose-Headers': 'Content-Disposition',
    });
    return new StreamableFile(buffer);
  }

  @Post(':id/qr/generate')
  @ApiOperation({
    summary:
      "Super-admin: re-render a doctor's booking QR from their current link",
  })
  @Permissions({ module: PermissionModule.DOCTORS, action: PermissionAction.UPDATE })
  async generateQr(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    this.assertSuperAdmin(user);
    return this.doctorsService.regenerateQr(id);
  }

  @Delete('me/qr')
  @ApiOperation({ summary: 'Doctor removes own profile QR code image' })
  @Permissions({ module: PermissionModule.DOCTORS, action: PermissionAction.UPDATE })
  removeOwnQr(@CurrentUser() user: AuthUser) {
    return this.doctorsService.removeQr(this.selfId(user));
  }

  // ── Super-admin: tenant management ────────────────────────
  /**
   * Creates a new doctor tenant (doctor profile + roles + login).
   * Super-admin only: the caller must be type=super_admin; the permission
   * check (doctors:create) is a secondary guard.
   */
  @Post()
  @ApiOperation({ summary: 'Super-admin: create a new doctor tenant' })
  @Permissions({ module: PermissionModule.DOCTORS, action: PermissionAction.CREATE })
  createDoctor(@CurrentUser() user: AuthUser, @Body() dto: CreateDoctorDto) {
    this.assertSuperAdmin(user);
    const base = this.settings.patientWebBase();
    return this.doctorsService.createTenant(dto, base);
  }

  @Public()
  @Post('register')
  @ApiOperation({
    summary:
      'Doctor self-registration. The account and its booking link are live immediately; the practice licence is collected for review after the fact, not as a gate.',
  })
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(
    FileInterceptor('license', {
      storage: memoryStorage(),
      limits: { fileSize: 6 * 1024 * 1024 },
    }),
  )
  async register(
    @Body() dto: RegisterDoctorDto,
    @UploadedFile() license: Express.Multer.File,
  ) {
    if (!license) {
      throw new AppException(ErrorCode.FILE_REQUIRED, {
        message: 'Please attach your practice licence or registration certificate.',
      });
    }
    await this.doctorsService.registerSelf(dto, license);
    // Deliberately thin: the caller is an unauthenticated form, so it gets a
    // confirmation and nothing about the tenant it just created.
    return {
      ok: true,
      message: 'Registration complete. You can sign in now.',
    };
  }

  @Get(':id/profile')
  @ApiOperation({
    summary: "Super-admin: a doctor's full profile, licence details and certificate",
  })
  @Permissions({ module: PermissionModule.DOCTORS, action: PermissionAction.READ })
  doctorProfile(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    this.assertSuperAdmin(user);
    return this.doctorsService.adminProfile(id);
  }

  @Post(':id/license')
  @ApiOperation({
    summary: "Super-admin: upload or replace a doctor's practice licence",
  })
  @Permissions({ module: PermissionModule.DOCTORS, action: PermissionAction.UPDATE })
  @ApiConsumes('multipart/form-data')
  @ApiBody(fileBody)
  @UseInterceptors(
    FileInterceptor('file', {
      storage: memoryStorage(),
      limits: { fileSize: 6 * 1024 * 1024 },
    }),
  )
  uploadLicense(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @UploadedFile() file: Express.Multer.File,
  ) {
    this.assertSuperAdmin(user);
    if (!file) {
      throw new AppException(ErrorCode.FILE_REQUIRED, {
        message: 'Please choose a licence or certificate file to upload.',
      });
    }
    return this.doctorsService.uploadLicense(id, file);
  }

  @Get('registrations/pending')
  @ApiOperation({ summary: 'Super-admin: registrations awaiting review' })
  @Permissions({ module: PermissionModule.DOCTORS, action: PermissionAction.READ })
  pendingRegistrations(@CurrentUser() user: AuthUser) {
    this.assertSuperAdmin(user);
    return this.doctorsService.listPending();
  }

  @Post(':id/approve')
  @ApiOperation({ summary: 'Super-admin: approve a doctor registration' })
  @Permissions({ module: PermissionModule.DOCTORS, action: PermissionAction.UPDATE })
  approveRegistration(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    this.assertSuperAdmin(user);
    return this.doctorsService.approveRegistration(id);
  }

  @Post(':id/reject')
  @ApiOperation({ summary: 'Super-admin: reject a doctor registration' })
  @Permissions({ module: PermissionModule.DOCTORS, action: PermissionAction.UPDATE })
  rejectRegistration(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: RejectDoctorDto,
  ) {
    this.assertSuperAdmin(user);
    return this.doctorsService.rejectRegistration(id, dto.reason);
  }

  @Post(':id/reset-password')
  @ApiOperation({
    summary:
      "Super-admin: set a new password for a doctor's own login (they are locked out otherwise)",
  })
  @Permissions({ module: PermissionModule.DOCTORS, action: PermissionAction.UPDATE })
  resetDoctorPassword(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ResetDoctorPasswordDto,
  ) {
    this.assertSuperAdmin(user);
    return this.doctorsService.resetLoginPassword(id, dto.password);
  }

  @Post(':id/regenerate-slug')
  @ApiOperation({ summary: 'Super-admin: rotate the doctor QR slug' })
  @Permissions({ module: PermissionModule.DOCTORS, action: PermissionAction.UPDATE })
  regenerateSlug(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    this.assertSuperAdmin(user);
    const base = this.settings.patientWebBase();
    return this.doctorsService.regenerateSlug(id, base);
  }

  @Post(':id/qr')
  @ApiOperation({ summary: 'Super-admin: upload doctor profile QR code image' })
  @Permissions({ module: PermissionModule.DOCTORS, action: PermissionAction.UPDATE })
  @ApiConsumes('multipart/form-data')
  @ApiBody(fileBody)
  @UseInterceptors(FileInterceptor('file', imageUpload))
  uploadDoctorQr(
    @Param('id', ParseUUIDPipe) id: string,
    @UploadedFile() file: Express.Multer.File,
  ) {
    return this.doctorsService.uploadQr(id, file);
  }

  @Delete(':id/qr')
  @ApiOperation({ summary: 'Super-admin: remove doctor profile QR code image' })
  @Permissions({ module: PermissionModule.DOCTORS, action: PermissionAction.UPDATE })
  removeDoctorQr(@Param('id', ParseUUIDPipe) id: string) {
    return this.doctorsService.removeQr(id);
  }

  // ── Admin reads/edits ──────────────────────────────────────
  @Get()
  @Permissions({ module: PermissionModule.DOCTORS, action: PermissionAction.READ })
  findAll() {
    return this.doctorsService.findAll();
  }

  @Get(':id')
  @Permissions({ module: PermissionModule.DOCTORS, action: PermissionAction.READ })
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.doctorsService.findOne(id);
  }

  @Patch(':id')
  @Permissions({ module: PermissionModule.DOCTORS, action: PermissionAction.UPDATE })
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateDoctorDto) {
    return this.doctorsService.update(id, dto);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Super-admin: permanently remove a doctor tenant' })
  @Permissions({ module: PermissionModule.DOCTORS, action: PermissionAction.DELETE })
  remove(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    this.assertSuperAdmin(user);
    return this.doctorsService.remove(id);
  }

  @Patch(':id/enable')
  @Permissions({ module: PermissionModule.DOCTORS, action: PermissionAction.UPDATE })
  enable(@Param('id', ParseUUIDPipe) id: string) {
    return this.doctorsService.setEnabled(id, true);
  }

  @Patch(':id/disable')
  @Permissions({ module: PermissionModule.DOCTORS, action: PermissionAction.UPDATE })
  disable(@Param('id', ParseUUIDPipe) id: string) {
    return this.doctorsService.setEnabled(id, false);
  }

  @Post(':id/photo')
  @Permissions({ module: PermissionModule.DOCTORS, action: PermissionAction.UPDATE })
  @ApiConsumes('multipart/form-data')
  @ApiBody(fileBody)
  @UseInterceptors(FileInterceptor('file', imageUpload))
  uploadPhoto(
    @Param('id', ParseUUIDPipe) id: string,
    @UploadedFile() file: Express.Multer.File,
  ) {
    return this.doctorsService.uploadPhoto(id, file);
  }

  private selfId(user: AuthUser): string {
    if (!user.doctorId) {
      throw new AppException(ErrorCode.FORBIDDEN, {
        message: 'This account is not linked to a doctor profile.',
      });
    }
    return user.doctorId;
  }

  private assertSuperAdmin(user: AuthUser): void {
    if (user.type !== UserType.SUPER_ADMIN) {
      throw new AppException(ErrorCode.FORBIDDEN, {
        message: 'Only the platform super-admin can perform this action.',
      });
    }
  }
}
