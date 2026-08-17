import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { PathlabsService } from './pathlabs.service';
import { CreatePathlabDto, UpdatePathlabDto } from './dto/pathlab.dto';
import { Permissions } from '../common/decorators/permissions.decorator';
import { PermissionAction, PermissionModule } from '../common/enums';

@ApiTags('Pathlabs')
@ApiBearerAuth()
@Controller('pathlabs')
export class PathlabsController {
  constructor(private readonly service: PathlabsService) {}

  @Get()
  @Permissions({ module: PermissionModule.PATHLABS, action: PermissionAction.READ })
  findAll() {
    return this.service.findAll();
  }

  @Post()
  @Permissions({ module: PermissionModule.PATHLABS, action: PermissionAction.CREATE })
  create(@Body() dto: CreatePathlabDto) {
    return this.service.create(dto);
  }

  @Patch(':id')
  @Permissions({ module: PermissionModule.PATHLABS, action: PermissionAction.UPDATE })
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdatePathlabDto) {
    return this.service.update(id, dto);
  }

  @Delete(':id')
  @Permissions({ module: PermissionModule.PATHLABS, action: PermissionAction.DELETE })
  remove(@Param('id', ParseUUIDPipe) id: string) {
    return this.service.remove(id);
  }
}
