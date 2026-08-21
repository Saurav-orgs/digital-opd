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
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { RolesService } from './roles.service';
import { CreateRoleDto, UpdateRoleDto } from './dto/role.dto';
import { Permissions } from '../common/decorators/permissions.decorator';
import { PermissionAction, PermissionModule } from '../common/enums';
import { CurrentUser, AuthUser } from '../common/decorators/current-user.decorator';

@ApiTags('Roles & Permissions')
@ApiBearerAuth()
@Controller()
export class RolesController {
  constructor(private readonly rolesService: RolesService) {}

  @Get('permissions')
  @Permissions({ module: PermissionModule.ROLES, action: PermissionAction.READ })
  listPermissions() {
    return this.rolesService.listPermissions();
  }

  @Get('roles')
  @Permissions({ module: PermissionModule.ROLES, action: PermissionAction.READ })
  findAll(@CurrentUser() user: AuthUser) {
    return this.rolesService.findAll(user);
  }

  @Get('roles/:id')
  @Permissions({ module: PermissionModule.ROLES, action: PermissionAction.READ })
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.rolesService.findOne(id);
  }

  @Post('roles')
  @Permissions({ module: PermissionModule.ROLES, action: PermissionAction.CREATE })
  create(@Body() dto: CreateRoleDto, @CurrentUser() user: AuthUser) {
    return this.rolesService.create(dto, user);
  }

  @Patch('roles/:id')
  @Permissions({ module: PermissionModule.ROLES, action: PermissionAction.UPDATE })
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateRoleDto) {
    return this.rolesService.update(id, dto);
  }

  @Delete('roles/:id')
  @Permissions({ module: PermissionModule.ROLES, action: PermissionAction.DELETE })
  remove(@Param('id', ParseUUIDPipe) id: string) {
    return this.rolesService.remove(id);
  }
}
