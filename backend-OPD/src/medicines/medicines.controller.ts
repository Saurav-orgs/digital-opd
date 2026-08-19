import { Controller, Get, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { MedicinesService } from './medicines.service';
import { Permissions } from '../common/decorators/permissions.decorator';
import { PermissionAction, PermissionModule } from '../common/enums';

@ApiTags('Medicines')
@ApiBearerAuth()
@Controller('medicines')
export class MedicinesController {
  constructor(private readonly service: MedicinesService) {}

  @Get()
  @ApiOperation({ summary: "Autocomplete over the clinic's medicine catalogue" })
  // Gated on appointments:update — the people who write prescriptions.
  @Permissions({ module: PermissionModule.APPOINTMENTS, action: PermissionAction.UPDATE })
  search(@Query('q') q: string) {
    return this.service.search(q ?? '');
  }
}
