import { Module } from '@nestjs/common';
import { SequelizeModule } from '@nestjs/sequelize';
import { Subscription } from '../database/models/subscription.model';
import { User } from '../database/models/user.model';
import { SubscriptionAccessService } from './subscription-access.service';

/** The access check on its own, so AuthModule can depend on it without a cycle. */
@Module({
  imports: [SequelizeModule.forFeature([Subscription, User])],
  providers: [SubscriptionAccessService],
  exports: [SubscriptionAccessService],
})
export class SubscriptionAccessModule {}
