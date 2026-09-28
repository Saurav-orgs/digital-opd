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
    // Each key is written only when the screen sent it, so a form that shows
    // one section does not blank the fields belonging to another.
    const writes: [string, string | undefined][] = [
      [SETTING_KEYS.patientWebBase, dto.patient_web_base],
      [SETTING_KEYS.invoiceLegalName, dto.invoice_legal_name],
      [SETTING_KEYS.invoiceAddress, dto.invoice_address],
      [SETTING_KEYS.invoiceGstin, dto.invoice_gstin?.toUpperCase()],
      [SETTING_KEYS.invoicePan, dto.invoice_pan?.toUpperCase()],
      [SETTING_KEYS.invoiceState, dto.invoice_state],
      [SETTING_KEYS.invoiceEmail, dto.invoice_email],
      [SETTING_KEYS.invoicePhone, dto.invoice_phone],
      [SETTING_KEYS.invoicePrefix, dto.invoice_prefix?.toUpperCase()],
    ];
    for (const [key, value] of writes) {
      if (value !== undefined) await this.settings.set(key, value);
    }
    return this.settings.all();
  }
}
