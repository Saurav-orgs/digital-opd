import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { BlockedNumbersService } from './blocked-numbers.service';
import { BlockNumberDto } from './dto/blocked-number.dto';
import { Permissions } from '../common/decorators/permissions.decorator';
import { PermissionAction, PermissionModule } from '../common/enums';
import { CurrentUser, AuthUser } from '../common/decorators/current-user.decorator';

@ApiTags('Blocked Numbers')
@ApiBearerAuth()
@Controller('blocked-numbers')
export class BlockedNumbersController {
  constructor(private readonly service: BlockedNumbersService) {}

  @Get()
  @ApiOperation({ summary: 'Numbers this clinic has blocked from booking' })
  @Permissions({ module: PermissionModule.APPOINTMENTS, action: PermissionAction.READ })
  list(@CurrentUser() user: AuthUser) {
    return this.service.list(user);
  }

  @Post()
  @ApiOperation({ summary: 'Block a number from booking with this clinic' })
  @Permissions({ module: PermissionModule.APPOINTMENTS, action: PermissionAction.UPDATE })
  block(@Body() dto: BlockNumberDto, @CurrentUser() user: AuthUser) {
    return this.service.block(dto, user);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Unblock a number' })
  @Permissions({ module: PermissionModule.APPOINTMENTS, action: PermissionAction.UPDATE })
  async unblock(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthUser,
  ) {
    await this.service.unblock(id, user);
    return { ok: true };
  }
}
