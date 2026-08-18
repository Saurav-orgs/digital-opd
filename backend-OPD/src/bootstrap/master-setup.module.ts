import { Module } from '@nestjs/common';
import { SequelizeModule } from '@nestjs/sequelize';
import { Doctor } from '../database/models/doctor.model';
import { Permission } from '../database/models/permission.model';
import { Role } from '../database/models/role.model';
import { RolePermission } from '../database/models/role-permission.model';
import { User } from '../database/models/user.model';
import { MasterSetupService } from './master-setup.service';

/**
 * Bootstraps a working SuperAdmin (full-access) login — and the clinic doctor
 * profile it owns — on every app start. See MasterSetupService for details:
 * this is the first-run "master service".
 */
@Module({
  imports: [
    SequelizeModule.forFeature([Permission, Role, RolePermission, User, Doctor]),
  ],
  providers: [MasterSetupService],
})
export class MasterSetupModule {}
