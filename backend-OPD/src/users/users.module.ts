import { Module } from '@nestjs/common';
import { SequelizeModule } from '@nestjs/sequelize';
import { UsersService } from './users.service';
import { UsersController } from './users.controller';
import { User } from '../database/models/user.model';
import { Role } from '../database/models/role.model';
import { Permission } from '../database/models/permission.model';

@Module({
  imports: [SequelizeModule.forFeature([User, Role, Permission])],
  controllers: [UsersController],
  providers: [UsersService],
  exports: [UsersService],
})
export class UsersModule {}
