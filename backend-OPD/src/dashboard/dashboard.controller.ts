import { Controller, Get } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { DashboardService } from './dashboard.service';
import { Permissions } from '../common/decorators/permissions.decorator';
import { PermissionAction, PermissionModule } from '../common/enums';
import { CurrentUser, AuthUser } from '../common/decorators/current-user.decorator';

@ApiTags('Dashboard')
@ApiBearerAuth()
@Controller('dashboard')
export class DashboardController {
  constructor(private readonly service: DashboardService) {}

  @Get()
  @ApiOperation({ summary: 'Today’s appointments + counts per doctor' })
  @Permissions({ module: PermissionModule.DASHBOARD, action: PermissionAction.READ })
  summary(@CurrentUser() user: AuthUser) {
    return this.service.summary(user);
  }
}
