import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
} from '@nestjs/common';
import { Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { OpdSchedulesService } from './opd-schedules.service';
import { MarkLeaveDto, ReplaceSchedulesDto } from './dto/schedule.dto';
import { Permissions } from '../common/decorators/permissions.decorator';
import { PermissionAction, PermissionModule } from '../common/enums';
import { SlotsService } from '../slots/slots.service';
import { AppException } from '../common/errors/app.exception';
import { ErrorCode } from '../common/errors/error-codes';

@ApiTags('OPD Schedules')
@ApiBearerAuth()
@Controller('doctors/:id')
export class OpdSchedulesController {
  constructor(
    private readonly service: OpdSchedulesService,
    private readonly slots: SlotsService,
  ) {}

  @Get('schedules')
  @Permissions({ module: PermissionModule.OPD_SCHEDULES, action: PermissionAction.READ })
  list(@Param('id', ParseUUIDPipe) id: string) {
    return this.service.list(id);
  }

  @Get('slots')
  @ApiOperation({ summary: 'Preview generated slots (admin — any doctor)' })
  @Permissions({ module: PermissionModule.OPD_SCHEDULES, action: PermissionAction.READ })
  previewSlots(
    @Param('id', ParseUUIDPipe) id: string,
    @Query('date') date: string,
  ) {
    if (!date) {
      throw new AppException(ErrorCode.BAD_REQUEST, {
        message: 'A date (YYYY-MM-DD) is required.',
      });
    }
    return this.slots.getDaySlots(id, date);
  }

  @Put('schedules')
  @ApiOperation({ summary: 'Replace weekly config (supports split sessions)' })
  @Permissions({ module: PermissionModule.OPD_SCHEDULES, action: PermissionAction.UPDATE })
  replace(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ReplaceSchedulesDto,
  ) {
    return this.service.replace(id, dto);
  }

  @Get('leave')
  @ApiOperation({ summary: 'List leave days for a doctor' })
  @Permissions({ module: PermissionModule.OPD_SCHEDULES, action: PermissionAction.READ })
  listLeave(@Param('id', ParseUUIDPipe) id: string) {
    return this.service.listLeave(id);
  }

  @Post('leave')
  @ApiOperation({
    summary:
      'Mark a date as leave (409 + booking list if bookings exist; resend with force:true to override)',
  })
  @Permissions({ module: PermissionModule.OPD_SCHEDULES, action: PermissionAction.UPDATE })
  markLeave(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: MarkLeaveDto,
  ) {
    return this.service.markLeave(id, dto);
  }

  @Delete('leave/:date')
  @Permissions({ module: PermissionModule.OPD_SCHEDULES, action: PermissionAction.UPDATE })
  removeLeave(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('date') date: string,
  ) {
    return this.service.removeLeave(id, date);
  }
}
