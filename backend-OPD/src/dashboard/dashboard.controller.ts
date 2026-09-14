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
  // The dashboard is the appointment list with counters on top: one screen,
  // one permission. `dashboard` stays in the catalogue for old grants but is
  // no longer asked for anywhere.
  @Permissions({ module: PermissionModule.APPOINTMENTS, action: PermissionAction.READ })
  summary(@CurrentUser() user: AuthUser) {
    return this.service.summary(user);
  }
}
