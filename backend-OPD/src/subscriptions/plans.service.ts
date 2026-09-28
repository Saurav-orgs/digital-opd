import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/sequelize';
import { Op } from 'sequelize';
import { Plan } from '../database/models/plan.model';
import { Subscription } from '../database/models/subscription.model';
import { CreatePlanDto, UpdatePlanDto } from './dto/plan.dto';
import { ActivityLogService } from '../activity/activity-log.service';
import { AuthUser } from '../common/decorators/current-user.decorator';
import { ActivityAction, SubscriptionStatus } from '../common/enums';
import { AppException } from '../common/errors/app.exception';
import { ErrorCode } from '../common/errors/error-codes';

export interface PriceBreakdown {
  base: number;
  gstRate: number;
  gst: number;
  total: number;
}

export interface PlanView {
  id: string;
  code: string;
  name: string;
  tagline: string | null;
  monthly: number;
  months: number;
  isActive: boolean;
  isRecommended: boolean;
  sortOrder: number;
  price: PriceBreakdown;
  /** How many doctors are on this plan right now. Super-admin view only. */
  activeCount?: number;
}

/** `ends_at` for a cycle starting at `from`: the same day-of-month, `months` later. */
export function cycleEnd(from: Date, months: number): Date {
  const d = new Date(from);
  d.setMonth(d.getMonth() + months);
  return d;
}

/**
 * The price list, as data.
 *
 * It used to be a constant in the source, so changing a price was a deploy
 * and nobody outside the repo could see what was being charged. The amounts
 * a checkout uses still come from here and never from the client — the
 * client only names a plan.
 */
@Injectable()
export class PlansService {
  private readonly gstRate: number;

  constructor(
    @InjectModel(Plan) private readonly planModel: typeof Plan,
    @InjectModel(Subscription) private readonly subscriptionModel: typeof Subscription,
    private readonly activity: ActivityLogService,
    config: ConfigService,
  ) {
    this.gstRate = config.get<number>('gstRatePercent')!;
  }

  /** Base + GST for a plan's full cycle, to the paisa. */
  price(plan: Plan): PriceBreakdown {
    const base = Math.round(Number(plan.monthly_amount) * plan.months * 100) / 100;
    const gst = Math.round(base * this.gstRate) / 100;
    return {
      base,
      gstRate: this.gstRate,
      gst,
      total: Math.round((base + gst) * 100) / 100,
    };
  }

  view(plan: Plan): PlanView {
    return {
      id: plan.id,
      code: plan.code,
      name: plan.name,
      tagline: plan.tagline,
      monthly: Number(plan.monthly_amount),
      months: plan.months,
      isActive: plan.is_active,
      isRecommended: plan.is_recommended,
      sortOrder: plan.sort_order,
      price: this.price(plan),
    };
  }

  /** What the landing page sells. */
  async listPublic(): Promise<PlanView[]> {
    const rows = await this.planModel.findAll({
      where: { is_active: true },
      order: [
        ['sort_order', 'ASC'],
        ['months', 'ASC'],
      ],
    });
    return rows.map((p) => this.view(p));
  }

  /** Everything, including deactivated plans, with a live subscriber count. */
  async listAll(): Promise<PlanView[]> {
    const rows = await this.planModel.findAll({
      order: [
        ['sort_order', 'ASC'],
        ['months', 'ASC'],
      ],
    });
    const counts = await this.activeCounts();
    return rows.map((p) => ({ ...this.view(p), activeCount: counts.get(p.id) ?? 0 }));
  }

  /** The plan a checkout is for. Only an active plan can be bought. */
  async findSellable(code: string): Promise<Plan> {
    const plan = await this.planModel.findOne({ where: { code, is_active: true } });
    if (!plan) {
      throw new AppException(ErrorCode.BAD_REQUEST, {
        message: 'That plan is not available. Please choose another one.',
      });
    }
    return plan;
  }

  /** Any plan by id, active or not — an admin grant may use a retired one. */
  async findById(id: string): Promise<Plan> {
    const plan = await this.planModel.findByPk(id);
    if (!plan) throw new AppException(ErrorCode.NOT_FOUND, { message: 'Unknown plan.' });
    return plan;
  }

  async create(dto: CreatePlanDto, actor: AuthUser): Promise<PlanView> {
    const code = dto.code.trim().toLowerCase();
    if (await this.planModel.findOne({ where: { code }, paranoid: false })) {
      throw new AppException(ErrorCode.CONFLICT, {
        message: `A plan with the code "${code}" already exists.`,
      });
    }
    const plan = await this.planModel.create({
      code,
      name: dto.name.trim(),
      tagline: dto.tagline?.trim() || null,
      monthly_amount: dto.monthly_amount.toFixed(2),
      months: dto.months,
      is_active: dto.is_active ?? true,
      is_recommended: dto.is_recommended ?? false,
      sort_order: dto.sort_order ?? 0,
    } as any);
    if (plan.is_recommended) await this.clearOtherRecommended(plan.id);

    this.activity.recordForUser(actor, {
      action: ActivityAction.PLAN_CREATED,
      summary: `${actor.name} created the ${plan.name} plan at ₹${plan.monthly_amount}/month for ${plan.months} month(s).`,
      entity_type: 'plan',
      entity_id: plan.id,
    });
    return this.view(plan);
  }

  /**
   * Edit a plan. The price only affects what is sold from now on — every
   * subscription stores the amount it was charged, so a paid cycle keeps its
   * price and a renewal picks up the new one.
   *
   * `code` and `months` cannot change once anyone has bought the plan: both
   * would quietly rewrite what existing records mean.
   */
  async update(id: string, dto: UpdatePlanDto, actor: AuthUser): Promise<PlanView> {
    const plan = await this.findById(id);
    const sold = await this.subscriptionModel.count({ where: { plan_ref: plan.id } });

    if (dto.months !== undefined && dto.months !== plan.months && sold > 0) {
      throw new AppException(ErrorCode.CONFLICT, {
        message:
          'The billing cycle cannot change once a plan has been bought. Deactivate this plan and create a new one instead.',
      });
    }

    const before = `₹${plan.monthly_amount}/month · ${plan.months} month(s)`;
    await plan.update({
      ...(dto.name !== undefined ? { name: dto.name.trim() } : {}),
      ...(dto.tagline !== undefined ? { tagline: dto.tagline?.trim() || null } : {}),
      ...(dto.monthly_amount !== undefined
        ? { monthly_amount: dto.monthly_amount.toFixed(2) }
        : {}),
      ...(dto.months !== undefined ? { months: dto.months } : {}),
      ...(dto.is_active !== undefined ? { is_active: dto.is_active } : {}),
      ...(dto.is_recommended !== undefined ? { is_recommended: dto.is_recommended } : {}),
      ...(dto.sort_order !== undefined ? { sort_order: dto.sort_order } : {}),
    } as any);
    if (plan.is_recommended) await this.clearOtherRecommended(plan.id);

    this.activity.recordForUser(actor, {
      action: ActivityAction.PLAN_UPDATED,
      summary: `${actor.name} updated the ${plan.name} plan (was ${before}, now ₹${plan.monthly_amount}/month · ${plan.months} month(s)${plan.is_active ? '' : ', inactive'}).`,
      entity_type: 'plan',
      entity_id: plan.id,
    });
    return this.view(plan);
  }

  /**
   * Retire a plan. A plan anyone has ever bought is deactivated rather than
   * removed: the subscriptions that point at it have to keep resolving.
   */
  async remove(id: string, actor: AuthUser): Promise<PlanView> {
    const plan = await this.findById(id);
    const sold = await this.subscriptionModel.count({ where: { plan_ref: plan.id } });
    if (sold > 0) {
      await plan.update({ is_active: false } as any);
      this.activity.recordForUser(actor, {
        action: ActivityAction.PLAN_UPDATED,
        summary: `${actor.name} retired the ${plan.name} plan; ${sold} subscription(s) still refer to it.`,
        entity_type: 'plan',
        entity_id: plan.id,
      });
      return this.view(plan);
    }
    await plan.destroy();
    this.activity.recordForUser(actor, {
      action: ActivityAction.PLAN_UPDATED,
      summary: `${actor.name} deleted the unused ${plan.name} plan.`,
      entity_type: 'plan',
      entity_id: plan.id,
    });
    return this.view(plan);
  }

  /** Doctors currently on each plan. */
  private async activeCounts(): Promise<Map<string, number>> {
    const rows = await this.subscriptionModel.findAll({
      attributes: ['plan_ref'],
      where: {
        status: SubscriptionStatus.ACTIVE,
        ends_at: { [Op.gt]: new Date() },
        plan_ref: { [Op.ne]: null },
      },
      raw: true,
    });
    const counts = new Map<string, number>();
    for (const r of rows as unknown as { plan_ref: string }[]) {
      counts.set(r.plan_ref, (counts.get(r.plan_ref) ?? 0) + 1);
    }
    return counts;
  }

  /** "Most popular" is a single badge, so setting it on one clears the rest. */
  private async clearOtherRecommended(keepId: string): Promise<void> {
    await this.planModel.update(
      { is_recommended: false } as any,
      { where: { id: { [Op.ne]: keepId }, is_recommended: true } },
    );
  }
}
