import { Controller, Get, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ActivityService } from './activity.service';
import { QueryActivityDto } from './dto/query-activity.dto';
import { Permissions } from '../common/decorators/permissions.decorator';
import { PermissionAction, PermissionModule } from '../common/enums';
import { CurrentUser, AuthUser } from '../common/decorators/current-user.decorator';

@ApiTags('Activity log')
@ApiBearerAuth()
@Controller('activity-logs')
export class ActivityController {
  constructor(private readonly activity: ActivityService) {}

  @Get()
  @ApiOperation({
    summary: 'Read the activity log (a doctor sees only their own clinic)',
  })
  @Permissions({ module: PermissionModule.ACTIVITY, action: PermissionAction.READ })
  list(@Query() query: QueryActivityDto, @CurrentUser() user: AuthUser) {
    return this.activity.list(query, user);
  }
}
