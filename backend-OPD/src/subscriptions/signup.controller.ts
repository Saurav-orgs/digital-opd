import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Public } from '../common/decorators/public.decorator';
import { SubscriptionsService } from './subscriptions.service';
import { PlansService } from './plans.service';
import { CreateAccountDto, ResumeSignupDto } from './dto/signup.dto';

/**
 * The paid sign-up, driven by the landing site. Every route is public: the
 * caller has no account yet, or has one that cannot sign in until it pays.
 * The email code that precedes `account` lives under /auth.
 */
@ApiTags('Sign-up')
@Public()
@Controller('signup')
export class SignupController {
  constructor(
    private readonly subscriptions: SubscriptionsService,
    private readonly plans: PlansService,
  ) {}

  @Get('plans')
  @ApiOperation({ summary: 'The plans on sale, with GST-inclusive totals' })
  listPlans() {
    return this.plans.listPublic();
  }

  @Post('account')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @ApiOperation({
    summary: 'Open the account (email must be verified) and a Cashfree order → checkout session',
  })
  createAccount(@Body() dto: CreateAccountDto) {
    return this.subscriptions.createAccount(dto);
  }

  @Post('resume')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @ApiOperation({ summary: 'An unpaid account opens a fresh order with its email and password' })
  resume(@Body() dto: ResumeSignupDto) {
    return this.subscriptions.resume(dto);
  }

  @Get('orders/:orderId')
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  @ApiOperation({ summary: 'Where an order stands; a pending one is re-checked with Cashfree' })
  orderStatus(@Param('orderId') orderId: string) {
    return this.subscriptions.orderStatus(orderId);
  }
}
