import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { IvfCaseSheetTemplatesService } from './ivf-case-sheet-templates.service';
import { SaveIvfTemplateDto, UpdateIvfTemplateDto } from './dto/ivf-case-sheet.dto';
import { Permissions } from '../common/decorators/permissions.decorator';
import { PermissionAction, PermissionModule } from '../common/enums';
import { CurrentUser, AuthUser } from '../common/decorators/current-user.decorator';

/**
 * A doctor's saved IVF case-sheets. Guarded by the `appointments` module for
 * the same reason the prescription templates are — using one is just writing a
 * case-sheet, and no role should be able to do the first but not the second.
 */
@ApiTags('IVF prescription templates')
@ApiBearerAuth()
@Controller('ivf-case-sheet-templates')
export class IvfCaseSheetTemplatesController {
  constructor(private readonly service: IvfCaseSheetTemplatesService) {}

  @Get()
  @ApiOperation({ summary: "The clinic's saved IVF case-sheets" })
  @Permissions({ module: PermissionModule.APPOINTMENTS, action: PermissionAction.READ })
  list(@CurrentUser() user: AuthUser) {
    return this.service.list(user);
  }

  @Post()
  @ApiOperation({ summary: 'Save a case-sheet as a template' })
  @Permissions({ module: PermissionModule.APPOINTMENTS, action: PermissionAction.CREATE })
  create(@Body() dto: SaveIvfTemplateDto, @CurrentUser() user: AuthUser) {
    return this.service.create(dto, user);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Rename or re-save a template' })
  @Permissions({ module: PermissionModule.APPOINTMENTS, action: PermissionAction.UPDATE })
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateIvfTemplateDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.service.update(id, dto, user);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Delete a template' })
  @Permissions({ module: PermissionModule.APPOINTMENTS, action: PermissionAction.DELETE })
  async remove(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthUser) {
    await this.service.remove(id, user);
    return { ok: true };
  }

  @Post(':id/apply/:appointmentId')
  @ApiOperation({ summary: "Fill an appointment's case-sheet draft from this template" })
  @Permissions({ module: PermissionModule.APPOINTMENTS, action: PermissionAction.UPDATE })
  apply(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('appointmentId', ParseUUIDPipe) appointmentId: string,
    @CurrentUser() user: AuthUser,
  ) {
    return this.service.apply(id, appointmentId, user);
  }
}
