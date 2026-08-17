import { Module } from '@nestjs/common';
import { SequelizeModule } from '@nestjs/sequelize';
import { User } from '../database/models/user.model';
import { Role } from '../database/models/role.model';
import { PathlabsService } from './pathlabs.service';
import { PathlabsController } from './pathlabs.controller';
import { UsersModule } from '../users/users.module';

@Module({
  imports: [SequelizeModule.forFeature([User, Role]), UsersModule],
  controllers: [PathlabsController],
  providers: [PathlabsService],
})
export class PathlabsModule {}
