import { Body, Controller, Get, Patch } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { SettingsService, SETTING_KEYS } from './settings.service';
import { UpdateSettingsDto } from './dto/settings.dto';
import { Permissions } from '../common/decorators/permissions.decorator';
import { PermissionAction, PermissionModule, UserType } from '../common/enums';
import { CurrentUser, AuthUser } from '../common/decorators/current-user.decorator';
import { AppException } from '../common/errors/app.exception';
import { ErrorCode } from '../common/errors/error-codes';

@ApiTags('Settings')
@ApiBearerAuth()
@Controller('settings')
export class SettingsController {
  constructor(private readonly settings: SettingsService) {}

  private assertSuperAdmin(user: AuthUser) {
    if (user.type !== UserType.SUPER_ADMIN) {
      throw new AppException(ErrorCode.FORBIDDEN, {
        message: 'Only the platform super-admin can perform this action.',
      });
    }
  }

  @Get()
  @ApiOperation({ summary: 'Super-admin: platform settings' })
  @Permissions({ module: PermissionModule.DOCTORS, action: PermissionAction.READ })
  async read(@CurrentUser() user: AuthUser) {
    this.assertSuperAdmin(user);
    return this.settings.all();
  }

  @Patch()
  @ApiOperation({ summary: 'Super-admin: update platform settings' })
  @Permissions({ module: PermissionModule.DOCTORS, action: PermissionAction.UPDATE })
  async update(@CurrentUser() user: AuthUser, @Body() dto: UpdateSettingsDto) {
    this.assertSuperAdmin(user);
    if (dto.patient_web_base !== undefined) {
      await this.settings.set(SETTING_KEYS.patientWebBase, dto.patient_web_base);
    }
    return this.settings.all();
  }
}
