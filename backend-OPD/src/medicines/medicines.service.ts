import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import { Op, fn, col, literal, where as sqlWhere } from 'sequelize';
import { MedicineCatalog } from '../database/models/medicine-catalog.model';

/**
 * The clinic's medicine vocabulary.
 *
 * Two layers. A shared reference list of well-known formulations, seeded once
 * and owned by nobody (`doctor_id IS NULL`), and the clinic's own names, which
 * grow every time the doctor issues a prescription. The clinic's own always
 * rank first, so within a few weeks the list reflects exactly what this doctor
 * prescribes — but a brand they have never written is still recognised on the
 * day they first say it out loud.
 *
 * That matters because of how dictation fails: a drug name it has never been
 * primed with comes back as an ordinary word that sounds the same, and the
 * editor can only offer "did you mean Mounjaro?" if something in here says
 * Mounjaro.
 */
@Injectable()
export class MedicinesService {
  constructor(
    @InjectModel(MedicineCatalog)
    private readonly catalogModel: typeof MedicineCatalog,
  ) {}

  /** Autocomplete for the prescription editor. Most-used names rank first. */
  async search(query: string, doctorId?: string | null, limit = 20): Promise<MedicineCatalog[]> {
    const rows = await this.catalogModel.findAll({
      where: this.visibleTo(doctorId, query),
      order: this.ranking(),
      // Over-fetch, because the clinic's own copy of a shared name collapses
      // into it below and would otherwise eat a slot from the result.
      limit: limit * 2,
    });
    return this.dedupeByName(rows).slice(0, limit);
  }

  /**
   * The names to hand the AI: the clinic's most-prescribed medicines. Capped
   * because a long list crowds out the transcript in the model's context and
   * exceeds what Whisper conditions on.
   */
  async vocabulary(doctorId?: string | null, limit = 120): Promise<string[]> {
    const rows = await this.catalogModel.findAll({
      where: this.visibleTo(doctorId),
      order: this.ranking(),
      limit: limit * 2,
      attributes: ['name', 'doctor_id', 'usage_count'],
    });
    return this.dedupeByName(rows)
      .slice(0, limit)
      .map((r) => r.name);
  }

  /**
   * The clinic's own names plus the shared reference list. A clinic never sees
   * another clinic's vocabulary — only what it has written itself and what
   * everybody gets.
   */
  private visibleTo(doctorId?: string | null, query?: string): any {
    const clauses: any[] = [];

    const q = query?.trim();
    if (q) clauses.push({ name: { [Op.iLike]: `%${q}%` } });
    if (doctorId) {
      clauses.push({ [Op.or]: [{ doctor_id: doctorId }, { doctor_id: null }] });
    }

    return clauses.length ? { [Op.and]: clauses } : {};
  }

  /**
   * What this clinic actually prescribes, ahead of the shared list — a name
   * the doctor has written before is a better suggestion than one merely known
   * to exist, however common.
   */
  private ranking(): any {
    return [
      [literal('(doctor_id IS NULL)'), 'ASC'],
      ['usage_count', 'DESC'],
      ['name', 'ASC'],
    ];
  }

  /**
   * One entry per name. A clinic that has issued a shared name has its own row
   * for it too; showing "Dolo" twice in an autocomplete helps nobody, and the
   * ranking above guarantees the clinic's own copy is the one kept.
   */
  private dedupeByName(rows: MedicineCatalog[]): MedicineCatalog[] {
    const seen = new Set<string>();
    return rows.filter((row) => {
      const key = row.name.trim().toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  /**
   * Record medicines the doctor actually issued. New names join the catalogue;
   * known ones get their usage count bumped so ranking reflects real habits.
   */
  async recordUsage(
    medicines: { name: string; strength?: string | null; form?: string | null }[],
    doctorId?: string | null,
  ): Promise<void> {
    for (const medicine of medicines) {
      const name = medicine.name?.trim();
      if (!name) continue;

      // Case-insensitive match within the same tenant. The lower(name)
      // comparison has to stay a Where instance — spreading it into a plain
      // object turns its internals into column names Postgres does not have.
      const conditions: any[] = [sqlWhere(fn('lower', col('name')), name.toLowerCase())];
      if (doctorId) conditions.push({ doctor_id: doctorId });
      const existing = await this.catalogModel.findOne({ where: { [Op.and]: conditions } });

      if (existing) {
        await existing.increment('usage_count');
        continue;
      }

      await this.catalogModel.create({
        name,
        strength: medicine.strength ?? null,
        form: medicine.form ?? null,
        doctor_id: doctorId ?? null,
        usage_count: 1,
      } as any);
    }
  }
}
