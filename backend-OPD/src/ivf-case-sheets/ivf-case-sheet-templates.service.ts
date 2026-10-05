import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import { Op } from 'sequelize';
import { IvfCaseSheetTemplate } from '../database/models/ivf-case-sheet-template.model';
import { IvfCaseSheetsService } from './ivf-case-sheets.service';
import { AppException } from '../common/errors/app.exception';
import { ErrorCode } from '../common/errors/error-codes';
import { AuthUser } from '../common/decorators/current-user.decorator';
import { SaveIvfTemplateDto, UpdateIvfTemplateDto } from './dto/ivf-case-sheet.dto';
import { sanitizeIvfCaseSheetData } from './ivf-case-sheet.schema';

/**
 * A doctor's saved IVF case-sheets, the starting points they apply to a new
 * visit and then adjust. Per-doctor only: there are no shared built-ins to
 * reconcile, so this is the plain CRUD `PrescriptionTemplatesService` would be
 * without them. Applying delegates the write to `IvfCaseSheetsService`, which
 * owns the access check, the specialization gate and the "not once issued"
 * rule — this decides only what to fill in.
 */
@Injectable()
export class IvfCaseSheetTemplatesService {
  constructor(
    @InjectModel(IvfCaseSheetTemplate)
    private readonly templateModel: typeof IvfCaseSheetTemplate,
    private readonly caseSheets: IvfCaseSheetsService,
  ) {}

  async list(user: AuthUser) {
    const doctorId = this.requireDoctor(user);
    const rows = await this.templateModel.findAll({
      where: { doctor_id: doctorId },
      order: [['name', 'ASC']],
    });
    return rows.map((t) => this.view(t));
  }

  async create(dto: SaveIvfTemplateDto, user: AuthUser) {
    const doctorId = this.requireDoctor(user);
    await this.assertNameFree(dto.name.trim(), doctorId, null);
    const created = await this.templateModel.create({
      doctor_id: doctorId,
      name: dto.name.trim(),
      data: sanitizeIvfCaseSheetData(dto.data),
    } as any);
    return this.view(created);
  }

  async update(id: string, dto: UpdateIvfTemplateDto, user: AuthUser) {
    const doctorId = this.requireDoctor(user);
    const template = await this.findOwn(id, doctorId);
    const name = dto.name?.trim() ?? template.name;
    if (name !== template.name) {
      await this.assertNameFree(name, doctorId, template.id);
    }
    await template.update({
      name,
      data:
        dto.data === undefined
          ? template.data
          : sanitizeIvfCaseSheetData(dto.data),
    } as any);
    return this.view(template);
  }

  async remove(id: string, user: AuthUser): Promise<void> {
    const doctorId = this.requireDoctor(user);
    const template = await this.findOwn(id, doctorId);
    await template.destroy();
  }

  /** Fill an appointment's case-sheet draft from a template. */
  async apply(id: string, appointmentId: string, user: AuthUser) {
    const doctorId = this.requireDoctor(user);
    const template = await this.findOwn(id, doctorId);
    return this.caseSheets.setData(appointmentId, template.data || {}, user);
  }

  // ── internals ────────────────────────────────────────────────

  private requireDoctor(user: AuthUser): string {
    if (!user.doctorId) {
      throw new AppException(ErrorCode.FORBIDDEN, {
        message: 'Case-sheet templates belong to a clinic.',
      });
    }
    return user.doctorId;
  }

  private async findOwn(id: string, doctorId: string): Promise<IvfCaseSheetTemplate> {
    const template = await this.templateModel.findOne({
      where: { id, doctor_id: doctorId },
    });
    if (!template) {
      throw new AppException(ErrorCode.NOT_FOUND, { message: 'Template not found.' });
    }
    return template;
  }

  private async assertNameFree(
    name: string,
    doctorId: string,
    exceptId: string | null,
  ): Promise<void> {
    const clash = await this.templateModel.findOne({
      where: {
        doctor_id: doctorId,
        name,
        ...(exceptId ? { id: { [Op.ne]: exceptId } } : {}),
      },
    });
    if (clash) throw new AppException(ErrorCode.TEMPLATE_NAME_TAKEN);
  }

  private view(t: IvfCaseSheetTemplate) {
    return { id: t.id, name: t.name, data: t.data || {} };
  }
}
