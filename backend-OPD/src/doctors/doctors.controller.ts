import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import {
  ApiBearerAuth,
  ApiBody,
  ApiConsumes,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { DoctorsService } from './doctors.service';
import { CreateDoctorDto, UpdateDoctorDto, UpdateOwnDoctorDto } from './dto/doctor.dto';
import { Permissions } from '../common/decorators/permissions.decorator';
import { PermissionAction, PermissionModule } from '../common/enums';
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
  constructor(private readonly doctorsService: DoctorsService) {}

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

  @Post('me/qr')
  @ApiOperation({ summary: 'Doctor uploads own payment QR' })
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

  // ── Admin CRUD ─────────────────────────────────────────────
  @Post()
  @Permissions({ module: PermissionModule.DOCTORS, action: PermissionAction.CREATE })
  create(@Body() dto: CreateDoctorDto) {
    return this.doctorsService.create(dto);
  }

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
  @Permissions({ module: PermissionModule.DOCTORS, action: PermissionAction.DELETE })
  remove(@Param('id', ParseUUIDPipe) id: string) {
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

  @Post(':id/qr')
  @Permissions({ module: PermissionModule.DOCTORS, action: PermissionAction.UPDATE })
  @ApiConsumes('multipart/form-data')
  @ApiBody(fileBody)
  @UseInterceptors(FileInterceptor('file', imageUpload))
  uploadQr(
    @Param('id', ParseUUIDPipe) id: string,
    @UploadedFile() file: Express.Multer.File,
  ) {
    return this.doctorsService.uploadQr(id, file);
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
}
