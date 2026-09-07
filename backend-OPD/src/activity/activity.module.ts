import { Global, Module } from '@nestjs/common';
import { SequelizeModule } from '@nestjs/sequelize';
import { ActivityLog } from '../database/models';
import { ActivityLogService } from './activity-log.service';
import { ActivityService } from './activity.service';
import { ActivityController } from './activity.controller';

/**
 * Global so any service can record activity without every module having to
 * import this one. The write side is deliberately separated from the read
 * side: `ActivityLogService` is injected all over the app, `ActivityService`
 * only backs the one endpoint.
 */
@Global()
@Module({
  imports: [SequelizeModule.forFeature([ActivityLog])],
  controllers: [ActivityController],
  providers: [ActivityLogService, ActivityService],
  exports: [ActivityLogService],
})
export class ActivityModule {}
