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
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import {
  PrescriptionTemplatesService,
  TemplateScope,
} from './prescription-templates.service';
import {
  SaveTemplateDto,
  UpdateTemplateDto,
} from './dto/prescription-template.dto';
import { Permissions } from '../common/decorators/permissions.decorator';
import { PermissionAction, PermissionModule } from '../common/enums';
import {
  CurrentUser,
  AuthUser,
} from '../common/decorators/current-user.decorator';

/**
 * Guarded by the `appointments` module rather than one of its own.
 *
 * A template is prescribing furniture: anyone who can write a prescription can
 * use one, and there is no role that should be able to do the first but not
 * the second. A separate permission module would be a switch nobody has a
 * reason to set differently, and one more row for every clinic to understand
 * on the permissions screen.
 */
@ApiTags('Prescription Templates')
@ApiBearerAuth()
@Controller('prescription-templates')
export class PrescriptionTemplatesController {
  constructor(private readonly service: PrescriptionTemplatesService) {}

  @Get()
  @ApiOperation({ summary: "The clinic's templates, built-in and its own" })
  @ApiQuery({ name: 'scope', required: false, enum: ['builtin', 'mine'] })
  @ApiQuery({ name: 'category', required: false })
  @ApiQuery({ name: 'q', required: false })
  @Permissions({
    module: PermissionModule.APPOINTMENTS,
    action: PermissionAction.READ,
  })
  list(
    @CurrentUser() user: AuthUser,
    @Query('scope') scope?: TemplateScope,
    @Query('category') category?: string,
    @Query('q') q?: string,
  ) {
    return this.service.list(user, { scope, category, q });
  }

  @Get('categories')
  @ApiOperation({ summary: 'Distinct categories, for the filter chips' })
  @Permissions({
    module: PermissionModule.APPOINTMENTS,
    action: PermissionAction.READ,
  })
  categories(@CurrentUser() user: AuthUser) {
    return this.service.categories(user);
  }

  @Post()
  @ApiOperation({ summary: 'Save a new template' })
  @Permissions({
    module: PermissionModule.APPOINTMENTS,
    action: PermissionAction.CREATE,
  })
  create(@Body() dto: SaveTemplateDto, @CurrentUser() user: AuthUser) {
    return this.service.create(dto, user);
  }

  @Patch(':id')
  @ApiOperation({
    summary: 'Edit a template — a built-in becomes a private override',
  })
  @Permissions({
    module: PermissionModule.APPOINTMENTS,
    action: PermissionAction.UPDATE,
  })
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateTemplateDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.service.update(id, dto, user);
  }

  @Delete(':id')
  @ApiOperation({
    summary: "Delete one of the clinic's own, or revert an edited built-in",
  })
  @Permissions({
    module: PermissionModule.APPOINTMENTS,
    action: PermissionAction.DELETE,
  })
  async remove(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthUser,
  ) {
    await this.service.remove(id, user);
    return { ok: true };
  }

  @Post(':id/apply/:appointmentId')
  @ApiOperation({
    summary: "Fill an appointment's prescription draft from this template",
  })
  @Permissions({
    module: PermissionModule.APPOINTMENTS,
    action: PermissionAction.UPDATE,
  })
  apply(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('appointmentId', ParseUUIDPipe) appointmentId: string,
    @CurrentUser() user: AuthUser,
  ) {
    return this.service.apply(id, appointmentId, user);
  }
}
