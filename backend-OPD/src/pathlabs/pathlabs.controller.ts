import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { PathlabsService } from './pathlabs.service';
import { CreatePathlabDto, UpdatePathlabDto } from './dto/pathlab.dto';
import { Permissions } from '../common/decorators/permissions.decorator';
import { PermissionAction, PermissionModule } from '../common/enums';
import { CurrentUser, AuthUser } from '../common/decorators/current-user.decorator';

@ApiTags('Pathlabs')
@ApiBearerAuth()
@Controller('pathlabs')
export class PathlabsController {
  constructor(private readonly service: PathlabsService) {}

  @Get()
  @Permissions({ module: PermissionModule.PATHLABS, action: PermissionAction.READ })
  findAll(@CurrentUser() user: AuthUser) {
    return this.service.findAll(user);
  }

  @Post()
  @Permissions({ module: PermissionModule.PATHLABS, action: PermissionAction.CREATE })
  create(@Body() dto: CreatePathlabDto, @CurrentUser() user: AuthUser) {
    return this.service.create(dto, user);
  }

  @Patch(':id')
  @Permissions({ module: PermissionModule.PATHLABS, action: PermissionAction.UPDATE })
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdatePathlabDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.service.update(id, dto, user);
  }

  @Delete(':id')
  @Permissions({ module: PermissionModule.PATHLABS, action: PermissionAction.DELETE })
  remove(@Param('id', ParseUUIDPipe) id: string) {
    return this.service.remove(id);
  }
}
