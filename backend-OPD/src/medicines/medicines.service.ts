import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import { Op, fn, col, where as sqlWhere } from 'sequelize';
import { MedicineCatalog } from '../database/models/medicine-catalog.model';

/**
 * The clinic's medicine vocabulary.
 *
 * Starts from a small seed of common Indian formulations and grows every time
 * the doctor issues a prescription, so within a few weeks it reflects exactly
 * what this doctor prescribes. That list is then fed back into speech
 * recognition and drafting, which is what makes drug names come out right.
 */
@Injectable()
export class MedicinesService {
  constructor(
    @InjectModel(MedicineCatalog)
    private readonly catalogModel: typeof MedicineCatalog,
  ) {}

  /** Autocomplete for the prescription editor. Most-used names rank first. */
  async search(query: string, limit = 20): Promise<MedicineCatalog[]> {
    const q = query?.trim();
    return this.catalogModel.findAll({
      where: q ? { name: { [Op.iLike]: `%${q}%` } } : {},
      order: [
        ['usage_count', 'DESC'],
        ['name', 'ASC'],
      ],
      limit,
    });
  }

  /**
   * The names to hand the AI: the clinic's most-prescribed medicines. Capped
   * because a long list crowds out the transcript in the model's context and
   * exceeds what Whisper conditions on.
   */
  async vocabulary(limit = 120): Promise<string[]> {
    const rows = await this.catalogModel.findAll({
      order: [
        ['usage_count', 'DESC'],
        ['name', 'ASC'],
      ],
      limit,
      attributes: ['name'],
    });
    return rows.map((r) => r.name);
  }

  /**
   * Record medicines the doctor actually issued. New names join the catalogue;
   * known ones get their usage count bumped so ranking reflects real habits.
   */
  async recordUsage(
    medicines: { name: string; strength?: string | null; form?: string | null }[],
  ): Promise<void> {
    for (const medicine of medicines) {
      const name = medicine.name?.trim();
      if (!name) continue;

      // Case-insensitive match so "Dolo 650" and "dolo 650" stay one entry.
      const existing = await this.catalogModel.findOne({
        where: sqlWhere(fn('lower', col('name')), name.toLowerCase()),
      });

      if (existing) {
        await existing.increment('usage_count');
        continue;
      }

      await this.catalogModel.create({
        name,
        strength: medicine.strength ?? null,
        form: medicine.form ?? null,
        usage_count: 1,
      } as any);
    }
  }
}
