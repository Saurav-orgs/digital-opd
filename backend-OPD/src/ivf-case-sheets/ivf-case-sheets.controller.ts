import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Res,
  StreamableFile,
} from '@nestjs/common';
import type { Response } from 'express';
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { IvfCaseSheetsService } from './ivf-case-sheets.service';
import { UpdateIvfCaseSheetDto } from './dto/ivf-case-sheet.dto';
import { RawResponse } from '../common/decorators/raw-response.decorator';
import { Permissions } from '../common/decorators/permissions.decorator';
import { PermissionAction, PermissionModule } from '../common/enums';
import { CurrentUser, AuthUser } from '../common/decorators/current-user.decorator';

/**
 * The IVF case-sheet for one visit, under the same `appointments/:id` routes as
 * the prescription and guarded by the same `appointments` permission module —
 * anyone who can write a prescription for this visit can write its case-sheet.
 * The specialization gate (IVF & Fertility only) is enforced in the service.
 */
@ApiTags('IVF prescription')
@ApiBearerAuth()
@Controller('appointments/:id/ivf-case-sheet')
export class IvfCaseSheetsController {
  constructor(private readonly service: IvfCaseSheetsService) {}

  @Get()
  @ApiOperation({ summary: 'The draft or issued IVF case-sheet for this visit' })
  @Permissions({ module: PermissionModule.APPOINTMENTS, action: PermissionAction.READ })
  get(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthUser) {
    return this.service.get(id, user);
  }

  @Patch()
  @ApiOperation({ summary: "Save the doctor's edits to the case-sheet draft" })
  @Permissions({ module: PermissionModule.APPOINTMENTS, action: PermissionAction.UPDATE })
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateIvfCaseSheetDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.service.update(id, dto, user);
  }

  @Post('issue')
  @ApiOperation({ summary: 'Issue the case-sheet to the patient (renders the PDF and notifies)' })
  @Permissions({ module: PermissionModule.APPOINTMENTS, action: PermissionAction.UPDATE })
  issue(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthUser) {
    return this.service.issue(id, user);
  }

  @Get('pdf')
  @ApiOperation({ summary: 'The issued case-sheet PDF itself, for download or share' })
  @Permissions({ module: PermissionModule.APPOINTMENTS, action: PermissionAction.READ })
  @RawResponse()
  async pdf(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthUser,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile> {
    const { buffer, filename } = await this.service.pdfFile(id, user);
    res.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': `inline; filename="${filename}"`,
      'Access-Control-Expose-Headers': 'Content-Disposition',
    });
    return new StreamableFile(buffer);
  }

  @Get('preview')
  @ApiOperation({
    summary:
      'Render the current draft as the PDF it would be issued as — nothing frozen or sent. ' +
      '`letterhead=false` leaves the doctor header and footer blank, for printing onto a pad.',
  })
  @ApiQuery({ name: 'letterhead', required: false, enum: ['true', 'false'] })
  @Permissions({ module: PermissionModule.APPOINTMENTS, action: PermissionAction.READ })
  @RawResponse()
  async preview(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthUser,
    @Res({ passthrough: true }) res: Response,
    @Query('letterhead') letterhead?: string,
  ): Promise<StreamableFile> {
    const { buffer, filename } = await this.service.previewFile(id, user, {
      letterhead: letterhead !== 'false' && letterhead !== '0',
    });
    res.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': `inline; filename="${filename}"`,
      'Access-Control-Expose-Headers': 'Content-Disposition',
      'Cache-Control': 'no-store',
    });
    return new StreamableFile(buffer);
  }

  @Delete()
  @ApiOperation({ summary: 'Withdraw an issued case-sheet: back to draft, PDF removed, notice cleared' })
  @Permissions({ module: PermissionModule.APPOINTMENTS, action: PermissionAction.UPDATE })
  withdraw(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthUser) {
    return this.service.withdraw(id, user);
  }

  @Delete('permanent')
  @ApiOperation({ summary: 'Delete the case-sheet outright (draft or issued)' })
  @Permissions({ module: PermissionModule.APPOINTMENTS, action: PermissionAction.UPDATE })
  remove(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthUser) {
    return this.service.remove(id, user);
  }
}
