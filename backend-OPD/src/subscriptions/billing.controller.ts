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
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { PlansService } from './plans.service';
import { SubscriptionsService } from './subscriptions.service';
import { PaymentEventsService } from './payment-events.service';
import { CreatePlanDto, UpdatePlanDto } from './dto/plan.dto';
import { CancelSubscriptionDto, GrantSubscriptionDto } from './dto/grant.dto';
import { QuerySubscriptionsDto } from './dto/query-subscriptions.dto';
import { QueryPaymentEventsDto } from './dto/query-payment-events.dto';
import { Permissions } from '../common/decorators/permissions.decorator';
import { PermissionAction, PermissionModule, UserType } from '../common/enums';
import { CurrentUser, AuthUser } from '../common/decorators/current-user.decorator';
import { AppException } from '../common/errors/app.exception';
import { ErrorCode } from '../common/errors/error-codes';

/**
 * Billing, from both ends.
 *
 * Everything under `/billing/plans` and `/billing/subscriptions` is the super
 * admin's: the price list, and who is on what. `/billing/me` is the doctor's
 * own — their current plan and their own payments, and nobody else's.
 *
 * The super-admin routes carry a `doctors` permission so the guard has
 * something to check, then narrow to the super admin by hand, exactly as
 * Settings and tenant creation already do. Billing is platform-level, so it
 * deliberately does not become a per-role module a clinic could grant itself.
 */
@ApiTags('Billing')
@ApiBearerAuth()
@Controller('billing')
export class BillingController {
  constructor(
    private readonly plans: PlansService,
    private readonly subscriptions: SubscriptionsService,
    private readonly events: PaymentEventsService,
  ) {}

  private assertSuperAdmin(user: AuthUser) {
    if (user.type !== UserType.SUPER_ADMIN) {
      throw new AppException(ErrorCode.FORBIDDEN, {
        message: 'Only the platform super-admin can manage plans and billing.',
      });
    }
  }

  // ── The doctor's own billing ───────────────────────────────

  @Get('me')
  @ApiOperation({ summary: 'The signed-in account: its current plan and payment history' })
  async mine(@CurrentUser() user: AuthUser) {
    return this.subscriptions.historyForUser(user.id);
  }

  @Get('me/events')
  @ApiOperation({ summary: "The signed-in account's own payment activity" })
  myEvents(@CurrentUser() user: AuthUser, @Query() query: QueryPaymentEventsDto) {
    return this.events.list(query, user);
  }

  // ── Plans (super admin) ────────────────────────────────────

  @Get('plans')
  @ApiOperation({ summary: 'Super-admin: every plan, including retired ones, with subscriber counts' })
  @Permissions({ module: PermissionModule.DOCTORS, action: PermissionAction.READ })
  listPlans(@CurrentUser() user: AuthUser) {
    this.assertSuperAdmin(user);
    return this.plans.listAll();
  }

  @Post('plans')
  @ApiOperation({ summary: 'Super-admin: create a plan' })
  @Permissions({ module: PermissionModule.DOCTORS, action: PermissionAction.CREATE })
  createPlan(@CurrentUser() user: AuthUser, @Body() dto: CreatePlanDto) {
    this.assertSuperAdmin(user);
    return this.plans.create(dto, user);
  }

  @Patch('plans/:id')
  @ApiOperation({
    summary:
      'Super-admin: edit a plan. A new price applies to sales from now on; paid cycles keep theirs.',
  })
  @Permissions({ module: PermissionModule.DOCTORS, action: PermissionAction.UPDATE })
  updatePlan(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdatePlanDto,
  ) {
    this.assertSuperAdmin(user);
    return this.plans.update(id, dto, user);
  }

  @Delete('plans/:id')
  @ApiOperation({
    summary: 'Super-admin: retire a plan. One that has been bought is deactivated, not deleted.',
  })
  @Permissions({ module: PermissionModule.DOCTORS, action: PermissionAction.DELETE })
  removePlan(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    this.assertSuperAdmin(user);
    return this.plans.remove(id, user);
  }

  // ── Subscriptions (super admin) ────────────────────────────

  @Get('subscriptions')
  @ApiOperation({ summary: 'Super-admin: which doctor is on which plan' })
  @Permissions({ module: PermissionModule.DOCTORS, action: PermissionAction.READ })
  listSubscriptions(@CurrentUser() user: AuthUser, @Query() query: QuerySubscriptionsDto) {
    this.assertSuperAdmin(user);
    return this.subscriptions.list(query);
  }

  @Get('subscriptions/summary')
  @ApiOperation({ summary: 'Super-admin: active / pending / expiring counts and money collected' })
  @Permissions({ module: PermissionModule.DOCTORS, action: PermissionAction.READ })
  summary(@CurrentUser() user: AuthUser) {
    this.assertSuperAdmin(user);
    return this.subscriptions.summary();
  }

  @Get('accounts')
  @ApiOperation({ summary: 'Super-admin: every doctor account and the plan it is on' })
  @Permissions({ module: PermissionModule.DOCTORS, action: PermissionAction.READ })
  accounts(@CurrentUser() user: AuthUser) {
    this.assertSuperAdmin(user);
    return this.subscriptions.accounts();
  }

  @Post('subscriptions/grant')
  @ApiOperation({
    summary: 'Super-admin: give an account a plan with no payment — trial, comp, or paid offline',
  })
  @Permissions({ module: PermissionModule.DOCTORS, action: PermissionAction.CREATE })
  grant(@CurrentUser() user: AuthUser, @Body() dto: GrantSubscriptionDto) {
    this.assertSuperAdmin(user);
    return this.subscriptions.grant(dto, user);
  }

  @Post('subscriptions/:id/cancel')
  @ApiOperation({ summary: 'Super-admin: end a subscription now. The doctor is locked out at once.' })
  @Permissions({ module: PermissionModule.DOCTORS, action: PermissionAction.UPDATE })
  cancel(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CancelSubscriptionDto,
  ) {
    this.assertSuperAdmin(user);
    return this.subscriptions.cancel(id, dto, user);
  }

  // ── Payment activity log ───────────────────────────────────

  @Get('events')
  @ApiOperation({
    summary:
      'Super-admin: the payment activity log — webhooks (including unsigned ones), status polls, and manual actions',
  })
  @Permissions({ module: PermissionModule.DOCTORS, action: PermissionAction.READ })
  listEvents(@CurrentUser() user: AuthUser, @Query() query: QueryPaymentEventsDto) {
    this.assertSuperAdmin(user);
    return this.events.list(query, user);
  }
}
