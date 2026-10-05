import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import { Op } from 'sequelize';
import { Sequelize } from 'sequelize-typescript';
import { Appointment } from '../database/models/appointment.model';
import { PrescriptionTemplate } from '../database/models/prescription-template.model';
import { PrescriptionTemplateMedicine } from '../database/models/prescription-template-medicine.model';
import { PrescriptionTemplateUsage } from '../database/models/prescription-template-usage.model';
import { PrescriptionsService } from '../prescriptions/prescriptions.service';
import { ActivityLogService } from '../activity/activity-log.service';
import { ActivityAction } from '../common/enums';
import { AppException } from '../common/errors/app.exception';
import { ErrorCode } from '../common/errors/error-codes';
import { AuthUser } from '../common/decorators/current-user.decorator';
import {
  SaveTemplateDto,
  TemplateMedicineDto,
  UpdateTemplateDto,
} from './dto/prescription-template.dto';

export type TemplateScope = 'builtin' | 'mine';

/**
 * Prescription templates: the doctor's saved starting points.
 *
 * Two things here are load-bearing and easy to get wrong.
 *
 * **Built-ins are shared rows.** `doctor_id IS NULL` means every tenant reads
 * the same row, so a doctor "editing a built-in in place" must never write to
 * it — one clinic's change would reach every other clinic. `update()` detects
 * that case and writes a private override instead, linked back by
 * `builtin_source_id`, and `list()` swaps the override in where it shadows
 * one. The doctor sees an edited built-in; every other doctor sees the
 * original.
 *
 * **Applying is a server-side operation**, not a form fill the client could do
 * for itself. It has to replace the draft's medicines in one go, bump
 * `usage_count`, and hand back the prescription in exactly the shape
 * `GET prescription` returns so the editor can swap its query data without a
 * refetch. Doing it here also makes "this prescription came from a template"
 * an auditable fact rather than an inference.
 */
@Injectable()
export class PrescriptionTemplatesService {
  constructor(
    @InjectModel(PrescriptionTemplate)
    private readonly templateModel: typeof PrescriptionTemplate,
    @InjectModel(PrescriptionTemplateMedicine)
    private readonly medicineModel: typeof PrescriptionTemplateMedicine,
    @InjectModel(PrescriptionTemplateUsage)
    private readonly usageModel: typeof PrescriptionTemplateUsage,
    @InjectModel(Appointment)
    private readonly appointmentModel: typeof Appointment,
    private readonly prescriptions: PrescriptionsService,
    private readonly activity: ActivityLogService,
    private readonly sequelize: Sequelize,
  ) {}

  /**
   * The templates this doctor can use.
   *
   * `scope` narrows to one tab. Without it both are returned, which is what
   * the "Use a template" menu inside the prescription editor wants — it groups
   * by category and does not care who owns what.
   */
  async list(
    user: AuthUser,
    opts: { scope?: TemplateScope; category?: string; q?: string } = {},
  ) {
    const doctorId = this.requireDoctor(user);

    const [builtins, own] = await Promise.all([
      opts.scope === 'mine'
        ? []
        : this.templateModel.findAll({
            where: { doctor_id: null },
            include: [this.medicineInclude()],
            order: [['name', 'ASC']],
          }),
      this.templateModel.findAll({
        where: { doctor_id: doctorId },
        include: [this.medicineInclude()],
        order: [['name', 'ASC']],
      }),
    ]);

    // An override stands in for the built-in it shadows; it is not a template
    // of the doctor's own and must not appear in both tabs.
    const overrideBySource = new Map(
      own
        .filter((t) => t.builtin_source_id)
        .map((t) => [t.builtin_source_id as string, t]),
    );

    const resolvedBuiltins = builtins.map(
      (b) => overrideBySource.get(b.id) ?? b,
    );
    const ownTemplates = own.filter((t) => !t.builtin_source_id);

    const rows =
      opts.scope === 'builtin'
        ? resolvedBuiltins
        : opts.scope === 'mine'
          ? ownTemplates
          : [...resolvedBuiltins, ...ownTemplates];

    const usage = await this.usageFor(doctorId);
    return this.filter(rows, opts).map((t) => this.view(t, usage));
  }

  /** The categories in use, for the filter chips. Built-ins included. */
  async categories(user: AuthUser): Promise<string[]> {
    const doctorId = this.requireDoctor(user);
    const rows = await this.templateModel.findAll({
      attributes: ['category'],
      where: { [Op.or]: [{ doctor_id: null }, { doctor_id: doctorId }] },
      group: ['category'],
      order: [['category', 'ASC']],
      raw: true,
    });
    return rows.map((r) => (r as unknown as { category: string }).category);
  }

  async create(dto: SaveTemplateDto, user: AuthUser) {
    const doctorId = this.requireDoctor(user);
    this.assertNotEmpty(dto.advice, dto.medicines);
    await this.assertNameFree(dto.name, doctorId, null);

    const created = await this.sequelize.transaction(async (t) => {
      const template = await this.templateModel.create(
        {
          doctor_id: doctorId,
          builtin_source_id: null,
          category: dto.category.trim(),
          name: dto.name.trim(),
          advice: dto.advice?.trim() || null,
          follow_up_days: dto.follow_up_days ?? null,
          is_builtin: false,
        } as any,
        { transaction: t },
      );
      await this.writeMedicines(template.id, dto.medicines, t);
      return template;
    });

    this.activity.recordForUser(user, {
      action: ActivityAction.PRESCRIPTION_TEMPLATE_SAVED,
      summary: `Created the prescription template "${created.name}".`,
      entity_type: 'prescription_template',
      entity_id: created.id,
      doctor_id: doctorId,
      metadata: { category: created.category, medicines: dto.medicines?.length ?? 0 },
    });

    return this.view(await this.reload(created.id), await this.usageFor(doctorId));
  }

  /**
   * Save an edit.
   *
   * Editing one of the doctor's own templates rewrites it. Editing a built-in
   * writes a private override the first time and rewrites that override
   * afterwards — the shared row is never touched, because it belongs to every
   * other clinic too.
   */
  async update(id: string, dto: UpdateTemplateDto, user: AuthUser) {
    const doctorId = this.requireDoctor(user);
    const target = await this.findVisible(id, doctorId);

    const merged = {
      category: (dto.category ?? target.category).trim(),
      name: (dto.name ?? target.name).trim(),
      advice:
        dto.advice === undefined ? target.advice : dto.advice.trim() || null,
      follow_up_days:
        dto.follow_up_days === undefined
          ? target.follow_up_days
          : (dto.follow_up_days ?? null),
    };
    const medicines =
      dto.medicines === undefined
        ? (await this.medicinesFor(target.id)).map((m) => this.medicineDto(m))
        : dto.medicines;

    this.assertNotEmpty(merged.advice ?? undefined, medicines);

    const isBuiltin = target.doctor_id === null;
    const existingOverride = isBuiltin
      ? await this.templateModel.findOne({
          where: { doctor_id: doctorId, builtin_source_id: target.id },
        })
      : null;
    const row = existingOverride ?? (isBuiltin ? null : target);

    await this.assertNameFree(merged.name, doctorId, row?.id ?? null);

    const saved = await this.sequelize.transaction(async (t) => {
      if (row) {
        await row.update(merged as any, { transaction: t });
        await this.writeMedicines(row.id, medicines, t);
        return row;
      }
      // First edit of a built-in: the override is born here.
      const override = await this.templateModel.create(
        {
          doctor_id: doctorId,
          builtin_source_id: target.id,
          ...merged,
          is_builtin: false,
        } as any,
        { transaction: t },
      );
      await this.writeMedicines(override.id, medicines, t);
      return override;
    });

    this.activity.recordForUser(user, {
      action: ActivityAction.PRESCRIPTION_TEMPLATE_SAVED,
      summary: `Updated the prescription template "${saved.name}".`,
      entity_type: 'prescription_template',
      entity_id: saved.id,
      doctor_id: doctorId,
      metadata: {
        category: saved.category,
        overrides_builtin: isBuiltin ? target.id : undefined,
      },
    });

    return this.view(await this.reload(saved.id), await this.usageFor(doctorId));
  }

  /**
   * Delete one of the doctor's own.
   *
   * A built-in cannot be deleted — it is not the doctor's to remove, and the
   * design says so too ("editable in place, not deletable"). Deleting an
   * override is allowed and means "put the original back", which is what
   * removing the shadowing row does.
   */
  async remove(id: string, user: AuthUser): Promise<void> {
    const doctorId = this.requireDoctor(user);
    const template = await this.findVisible(id, doctorId);

    if (template.doctor_id === null) {
      throw new AppException(ErrorCode.FORBIDDEN, {
        message:
          'Built-in templates cannot be deleted. You can edit one instead, ' +
          'and your changes stay with your clinic.',
      });
    }

    const wasOverride = !!template.builtin_source_id;
    await template.destroy();

    this.activity.recordForUser(user, {
      action: ActivityAction.PRESCRIPTION_TEMPLATE_DELETED,
      summary: wasOverride
        ? `Reverted the built-in template "${template.name}" to its original.`
        : `Deleted the prescription template "${template.name}".`,
      entity_type: 'prescription_template',
      entity_id: template.id,
      doctor_id: doctorId,
      metadata: { reverted_builtin: wasOverride },
    });
  }

  /**
   * Fill an appointment's prescription draft from a template.
   *
   * Delegates the write to `PrescriptionsService.update`, which already owns
   * the access check, the "not once issued" rule, medicine replacement and the
   * response shape. Re-implementing any of that here would be a second set of
   * rules for the same table.
   *
   * What is replaced: medicines, advice and the follow-up date — those *are*
   * the template. Diagnosis is filled only when the draft has none. The
   * prototype overwrites it with the template's name, which is a reasonable
   * default on an empty form and plain destructive once the doctor has typed
   * what they actually concluded.
   */
  async apply(id: string, appointmentId: string, user: AuthUser) {
    const doctorId = this.requireDoctor(user);
    const template = await this.findVisible(id, doctorId);
    const medicines = await this.medicinesFor(template.id);

    // `prescriptions.update` performs the authoritative access check; this
    // read is for the appointment's date, which the follow-up counts from.
    const appointment = await this.appointmentModel.findByPk(appointmentId);
    if (!appointment) {
      throw new AppException(ErrorCode.NOT_FOUND, {
        message: 'Appointment not found.',
      });
    }

    const current = await this.prescriptions.get(appointmentId, user);
    const keepDiagnosis = (current as { diagnosis?: string | null }).diagnosis;

    const result = await this.prescriptions.update(
      appointmentId,
      {
        // "Viral fever — adult" is a template name; "Viral fever" is a
        // diagnosis. The suffix after the dash is which variant of the
        // template this is, and has no business on the prescription.
        diagnosis: keepDiagnosis?.trim()
          ? keepDiagnosis
          : template.name.replace(/\s+—.*$/, '').trim(),
        advice: template.advice ?? undefined,
        follow_up_date: this.followUpDate(
          appointment.appointment_date,
          template.follow_up_days,
        ),
        medicines: medicines.map((m) => ({
          medicine_name: m.medicine_name,
          strength: m.strength ?? undefined,
          form: m.form ?? undefined,
          dosage: m.dosage,
          duration_days: m.duration_days ?? undefined,
          instructions: m.instructions ?? undefined,
        })),
      },
      user,
    );

    // Counted against this clinic, never against the shared row. Best-effort:
    // the prescription is already filled, and a counter that failed to move
    // must not read as a failed apply.
    try {
      await this.bumpUsage(doctorId, template.id);
    } catch {
      // Deliberately swallowed — see above.
    }

    this.activity.recordForUser(user, {
      action: ActivityAction.PRESCRIPTION_TEMPLATE_APPLIED,
      summary:
        `Applied the template "${template.name}" to ` +
        `${appointment.patient_name}'s prescription.`,
      entity_type: 'prescription_template',
      entity_id: template.id,
      doctor_id: doctorId,
      metadata: {
        appointment_id: appointmentId,
        medicine_count: medicines.length,
      },
    });

    return result;
  }

  // ── internals ────────────────────────────────────────────────

  /**
   * Every route here is doctor-scoped. Staff carry `doctorId` too, so this is
   * not "is a doctor" — it is "belongs to a clinic", the same check
   * `PrescriptionsService.assertAccess` makes.
   */
  private requireDoctor(user: AuthUser): string {
    if (!user.doctorId) {
      throw new AppException(ErrorCode.FORBIDDEN, {
        message: 'Prescription templates belong to a clinic.',
      });
    }
    return user.doctorId;
  }

  /** A template is visible when it is shared or the doctor's own. */
  private async findVisible(
    id: string,
    doctorId: string,
  ): Promise<PrescriptionTemplate> {
    const template = await this.templateModel.findOne({
      where: {
        id,
        [Op.or]: [{ doctor_id: null }, { doctor_id: doctorId }],
      },
    });
    if (!template) {
      throw new AppException(ErrorCode.NOT_FOUND, {
        message: 'Template not found.',
      });
    }
    return template;
  }

  /**
   * The rule no CHECK constraint can hold: it spans both tables. An
   * advice-only template is valid and common — a fertility or diet-and-rest
   * template often carries no drug at all — so this asks for *either*, never
   * for a medicine.
   */
  private assertNotEmpty(
    advice: string | undefined,
    medicines: TemplateMedicineDto[] | undefined,
  ): void {
    const hasMedicine = (medicines ?? []).some((m) =>
      m.medicine_name?.trim(),
    );
    if (!hasMedicine && !advice?.trim()) {
      throw new AppException(ErrorCode.TEMPLATE_EMPTY);
    }
  }

  /**
   * Checked here rather than left to the unique index so the doctor gets the
   * sentence rather than a constraint name. The index is still what makes it
   * true under a race.
   */
  private async assertNameFree(
    name: string,
    doctorId: string,
    exceptId: string | null,
  ): Promise<void> {
    const clash = await this.templateModel.findOne({
      where: {
        doctor_id: doctorId,
        name: name.trim(),
        ...(exceptId ? { id: { [Op.ne]: exceptId } } : {}),
      },
    });
    if (clash) throw new AppException(ErrorCode.TEMPLATE_NAME_TAKEN);
  }

  private medicineInclude() {
    return {
      model: PrescriptionTemplateMedicine,
      required: false,
    };
  }

  private medicinesFor(
    templateId: string,
  ): Promise<PrescriptionTemplateMedicine[]> {
    return this.medicineModel.findAll({
      where: { template_id: templateId },
      order: [['position', 'ASC']],
    });
  }

  /** Full replacement — the editor always sends the whole list. */
  private async writeMedicines(
    templateId: string,
    medicines: TemplateMedicineDto[] | undefined,
    transaction: any,
  ): Promise<void> {
    await this.medicineModel.destroy({
      where: { template_id: templateId },
      transaction,
    });
    const rows = (medicines ?? [])
      .filter((m) => m.medicine_name?.trim())
      .map((m, index) => ({
        template_id: templateId,
        position: index,
        medicine_name: m.medicine_name.trim(),
        strength: m.strength?.trim() || null,
        form: m.form?.trim() || null,
        dosage: m.dosage?.trim() || '',
        duration_days: m.duration_days ?? null,
        duration_text: m.duration_text?.trim() || null,
        instructions: m.instructions?.trim() || null,
      }));
    if (rows.length) {
      await this.medicineModel.bulkCreate(rows as any, { transaction });
    }
  }

  private medicineDto(m: PrescriptionTemplateMedicine): TemplateMedicineDto {
    return {
      medicine_name: m.medicine_name,
      strength: m.strength ?? undefined,
      form: m.form ?? undefined,
      dosage: m.dosage,
      duration_days: m.duration_days ?? undefined,
      duration_text: m.duration_text ?? undefined,
      instructions: m.instructions ?? undefined,
    };
  }

  /**
   * Counted from the visit, not from today. A template applied while writing
   * up yesterday's consultation should still say "review a week after the
   * visit", which is what the doctor meant.
   */
  private followUpDate(
    appointmentDate: string,
    days: number | null,
  ): string | undefined {
    if (!days) return undefined;
    const [y, m, d] = appointmentDate.split('-').map(Number);
    const at = new Date(Date.UTC(y, m - 1, d + days));
    return at.toISOString().slice(0, 10);
  }

  /** This clinic's counts, by template id. */
  private async usageFor(doctorId: string): Promise<Map<string, number>> {
    const rows = await this.usageModel.findAll({
      where: { doctor_id: doctorId },
      attributes: ['template_id', 'usage_count'],
      raw: true,
    });
    return new Map(
      rows.map((r) => {
        const row = r as unknown as { template_id: string; usage_count: number };
        return [row.template_id, row.usage_count];
      }),
    );
  }

  /**
   * One row per clinic per template. `findOrCreate` then `increment` rather
   * than a read-modify-write, so two tabs applying at once cannot lose a
   * count — the unique index makes the create safe and the increment is
   * atomic in the database.
   */
  private async bumpUsage(doctorId: string, templateId: string): Promise<void> {
    await this.usageModel.findOrCreate({
      where: { doctor_id: doctorId, template_id: templateId },
      defaults: { doctor_id: doctorId, template_id: templateId, usage_count: 0 } as any,
    });
    await this.usageModel.increment('usage_count', {
      by: 1,
      where: { doctor_id: doctorId, template_id: templateId },
    });
    await this.usageModel.update(
      { last_used_at: new Date() } as any,
      { where: { doctor_id: doctorId, template_id: templateId } },
    );
  }

  private reload(id: string): Promise<PrescriptionTemplate> {
    return this.templateModel.findByPk(id, {
      include: [this.medicineInclude()],
    }) as Promise<PrescriptionTemplate>;
  }

  private filter(
    rows: PrescriptionTemplate[],
    opts: { category?: string; q?: string },
  ): PrescriptionTemplate[] {
    const q = opts.q?.trim().toLowerCase();
    return rows.filter((t) => {
      if (opts.category && t.category !== opts.category) return false;
      if (!q) return true;
      // Searched across the medicine names too: "what did I write for
      // metformin" is how a doctor looks for a template they half remember.
      return (
        t.name.toLowerCase().includes(q) ||
        t.category.toLowerCase().includes(q) ||
        (t.advice ?? '').toLowerCase().includes(q) ||
        (t.medicines ?? []).some((m) =>
          m.medicine_name.toLowerCase().includes(q),
        )
      );
    });
  }

  private view(
    t: PrescriptionTemplate,
    usage: Map<string, number> = new Map(),
  ) {
    const medicines = [...(t.medicines ?? [])].sort(
      (a, b) => a.position - b.position,
    );
    return {
      id: t.id,
      category: t.category,
      name: t.name,
      advice: t.advice,
      follow_up_days: t.follow_up_days,
      /**
       * True for a shared row *and* for a doctor's override of one — both are
       * "one of the eight" as far as the tabs are concerned, and the override
       * must not jump to the My templates tab the moment it is edited.
       */
      is_builtin: t.is_builtin || !!t.builtin_source_id,
      /** So the UI can offer "revert to the original". */
      overrides_builtin: !!t.builtin_source_id,
      /**
       * This clinic's own count. An override and the built-in it shadows are
       * two rows, so the override inherits the built-in's tally rather than
       * restarting at zero the moment the doctor tweaks the advice.
       */
      usage_count:
        (usage.get(t.id) ?? 0) +
        (t.builtin_source_id ? (usage.get(t.builtin_source_id) ?? 0) : 0),
      medicines: medicines.map((m) => ({
        medicine_name: m.medicine_name,
        strength: m.strength,
        form: m.form,
        dosage: m.dosage,
        duration_days: m.duration_days,
        duration_text: m.duration_text,
        instructions: m.instructions,
      })),
    };
  }
}
