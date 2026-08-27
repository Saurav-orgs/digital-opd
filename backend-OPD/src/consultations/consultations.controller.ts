import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Res,
  StreamableFile,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import { memoryStorage } from 'multer';
import {
  ApiBearerAuth,
  ApiBody,
  ApiConsumes,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { ConsultationsService } from './consultations.service';
import { PrescriptionsService } from '../prescriptions/prescriptions.service';
import { RawResponse } from '../common/decorators/raw-response.decorator';
import { UpdatePrescriptionDto } from '../prescriptions/dto/prescription.dto';
import { Permissions } from '../common/decorators/permissions.decorator';
import { PermissionAction, PermissionModule } from '../common/enums';
import { CurrentUser, AuthUser } from '../common/decorators/current-user.decorator';

@ApiTags('Consultation & prescription')
@ApiBearerAuth()
@Controller('appointments/:id')
export class ConsultationsController {
  constructor(
    private readonly consultations: ConsultationsService,
    private readonly prescriptions: PrescriptionsService,
  ) {}

  @Post('consultation/audio')
  @ApiOperation({
    summary:
      'Upload the consultation recording; transcription and drafting run in the background',
  })
  @Permissions({ module: PermissionModule.APPOINTMENTS, action: PermissionAction.UPDATE })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      required: ['audio'],
      properties: { audio: { type: 'string', format: 'binary' } },
    },
  })
  @UseInterceptors(
    FileInterceptor('audio', {
      storage: memoryStorage(),
      // A long consultation is a big file; audio is discarded after transcription.
      limits: { fileSize: 100 * 1024 * 1024 },
    }),
  )
  startConsultation(
    @Param('id', ParseUUIDPipe) id: string,
    @UploadedFile() audio: Express.Multer.File,
    @CurrentUser() user: AuthUser,
  ) {
    return this.consultations.startFromAudio(id, audio, user);
  }

  @Get('consultation')
  @ApiOperation({ summary: 'Poll transcription/drafting progress' })
  @Permissions({ module: PermissionModule.APPOINTMENTS, action: PermissionAction.READ })
  getConsultation(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthUser,
  ) {
    return this.consultations.get(id, user);
  }

  @Get('prescription')
  @ApiOperation({ summary: 'The draft or issued prescription for this visit' })
  @Permissions({ module: PermissionModule.APPOINTMENTS, action: PermissionAction.READ })
  getPrescription(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthUser,
  ) {
    return this.prescriptions.get(id, user);
  }

  @Patch('prescription')
  @ApiOperation({ summary: "Save the doctor's edits to the draft" })
  @Permissions({ module: PermissionModule.APPOINTMENTS, action: PermissionAction.UPDATE })
  updatePrescription(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdatePrescriptionDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.prescriptions.update(id, dto, user);
  }

  @Post('prescription/handwriting')
  @ApiOperation({
    summary: 'Save a handwritten prescription image (drawn on a tablet)',
  })
  @Permissions({ module: PermissionModule.APPOINTMENTS, action: PermissionAction.UPDATE })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      required: ['file'],
      properties: { file: { type: 'string', format: 'binary' } },
    },
  })
  @UseInterceptors(
    FileInterceptor('file', {
      storage: memoryStorage(),
      limits: { fileSize: 12 * 1024 * 1024 },
    }),
  )
  saveHandwriting(
    @Param('id', ParseUUIDPipe) id: string,
    @UploadedFile() file: Express.Multer.File,
    @CurrentUser() user: AuthUser,
  ) {
    return this.prescriptions.saveHandwriting(id, file, user);
  }

  @Get('prescription/pdf')
  @ApiOperation({
    summary: 'The issued prescription PDF itself, for download or native share',
  })
  @Permissions({ module: PermissionModule.APPOINTMENTS, action: PermissionAction.READ })
  @RawResponse()
  async prescriptionPdf(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthUser,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile> {
    const { buffer, filename } = await this.prescriptions.pdfFile(id, user);
    res.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': `inline; filename="${filename}"`,
      'Access-Control-Expose-Headers': 'Content-Disposition',
    });
    return new StreamableFile(buffer);
  }

  @Post('prescription/issue')
  @ApiOperation({
    summary: 'Issue the prescription to the patient (renders the PDF and notifies)',
  })
  @Permissions({ module: PermissionModule.APPOINTMENTS, action: PermissionAction.UPDATE })
  issuePrescription(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthUser,
  ) {
    return this.prescriptions.issue(id, user);
  }
}
