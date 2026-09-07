import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import { Op, WhereOptions } from 'sequelize';
import { ActivityLog } from '../database/models';
import { QueryActivityDto } from './dto/query-activity.dto';
import { AuthUser } from '../common/decorators/current-user.decorator';
import { UserType } from '../common/enums';

/** Read side of the activity log. Nothing here ever writes. */
@Injectable()
export class ActivityService {
  constructor(
    @InjectModel(ActivityLog) private readonly model: typeof ActivityLog,
  ) {}

  async list(query: QueryActivityDto, user: AuthUser) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 50;

    const where: WhereOptions = {};

    // Tenant scope first, and not overridable by a query parameter: a doctor
    // reads their own clinic's history and nobody else's. Only the super admin
    // sees across tenants.
    if (user.type !== UserType.SUPER_ADMIN) {
      (where as any).doctor_id = user.doctorId;
    }

    if (query.action) (where as any).action = query.action;
    if (query.actor_type) (where as any).actor_type = query.actor_type;
    if (query.actor_id) (where as any).actor_id = query.actor_id;
    if (query.entity_type) (where as any).entity_type = query.entity_type;
    if (query.entity_id) (where as any).entity_id = query.entity_id;

    if (query.from || query.to) {
      const range: Record<symbol, Date> = {};
      if (query.from) range[Op.gte] = new Date(`${query.from}T00:00:00.000Z`);
      // Inclusive: a `to` of 2026-09-30 must include that whole day, not stop
      // at midnight as a plain date comparison would.
      if (query.to) range[Op.lte] = new Date(`${query.to}T23:59:59.999Z`);
      // `createdAt` is the model attribute; Sequelize maps it to the
      // created_at column. Naming the column directly here happens to work by
      // passthrough, which is not something a filter on an audit log should
      // depend on.
      (where as any).createdAt = range;
    }

    const { rows, count } = await this.model.findAndCountAll({
      where,
      order: [['createdAt', 'DESC']],
      limit,
      offset: (page - 1) * limit,
    });

    return {
      items: rows,
      total: count,
      page,
      limit,
      pages: Math.ceil(count / limit) || 1,
    };
  }
}
