import { Module } from '@nestjs/common';
import { SequelizeModule } from '@nestjs/sequelize';
import { BlockedNumber } from '../database/models/blocked-number.model';
import { BlockedNumbersService } from './blocked-numbers.service';
import { BlockedNumbersController } from './blocked-numbers.controller';

@Module({
  imports: [SequelizeModule.forFeature([BlockedNumber])],
  controllers: [BlockedNumbersController],
  providers: [BlockedNumbersService],
  exports: [BlockedNumbersService],
})
export class BlockedNumbersModule {}
