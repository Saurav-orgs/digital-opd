import { Controller, Get, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { MedicinesService } from './medicines.service';
import { Permissions } from '../common/decorators/permissions.decorator';
import { PermissionAction, PermissionModule } from '../common/enums';
import { CurrentUser, AuthUser } from '../common/decorators/current-user.decorator';

@ApiTags('Medicines')
@ApiBearerAuth()
@Controller('medicines')
export class MedicinesController {
  constructor(private readonly service: MedicinesService) {}

  @Get()
  @ApiOperation({ summary: "Autocomplete over the clinic's medicine catalogue" })
  @ApiQuery({ name: 'q', required: false, description: 'Name fragment; omit for the whole catalogue' })
  @ApiQuery({ name: 'limit', required: false, description: 'Max rows, 1-500 (default 20)' })
  // Gated on appointments:update — the people who write prescriptions.
  @Permissions({ module: PermissionModule.APPOINTMENTS, action: PermissionAction.UPDATE })
  search(
    @Query('q') q: string,
    /**
     * Autocomplete wants a handful; the editor's "is this a real medicine?"
     * check wants the whole vocabulary to compare against, so the caller says
     * which. Capped, because the catalogue is unbounded.
     */
    @Query('limit') limit: string | undefined,
    @CurrentUser() user: AuthUser,
  ) {
    const parsed = Number.parseInt(limit ?? '', 10);
    const capped = Number.isFinite(parsed)
      ? Math.min(Math.max(parsed, 1), 500)
      : undefined;
    return this.service.search(q ?? '', user.doctorId, capped);
  }
}
