import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { SequelizeModule } from '@nestjs/sequelize';
import { AuthModule } from '../auth/auth.module';
import { UsersModule } from '../users/users.module';
import { Subscription } from '../database/models/subscription.model';
import { User } from '../database/models/user.model';
import { Doctor } from '../database/models/doctor.model';
import { Plan } from '../database/models/plan.model';
import { PaymentEvent } from '../database/models/payment-event.model';
import { CashfreeService } from './cashfree.service';
import { SubscriptionsService } from './subscriptions.service';
import { SubscriptionAccessModule } from './subscription-access.module';
import { PlansService } from './plans.service';
import { PaymentEventsService } from './payment-events.service';
import { SignupController } from './signup.controller';
import { BillingController } from './billing.controller';
import { PaymentWebhookController } from './payment-webhook.controller';

@Module({
  imports: [
    ConfigModule,
    AuthModule,
    UsersModule,
    SubscriptionAccessModule,
    SequelizeModule.forFeature([Subscription, User, Doctor, Plan, PaymentEvent]),
  ],
  controllers: [SignupController, BillingController, PaymentWebhookController],
  providers: [CashfreeService, SubscriptionsService, PlansService, PaymentEventsService],
  exports: [SubscriptionsService, PlansService],
})
export class SubscriptionsModule {}
