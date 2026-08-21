import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import { Op } from 'sequelize';
import { User } from '../database/models/user.model';
import { Role } from '../database/models/role.model';
import { UsersService } from '../users/users.service';
import { CreatePathlabDto, UpdatePathlabDto } from './dto/pathlab.dto';
import { UserType } from '../common/enums';
import { AppException } from '../common/errors/app.exception';
import { ErrorCode } from '../common/errors/error-codes';
import { AuthUser } from '../common/decorators/current-user.decorator';

const PATHLAB_ROLE_NAME = 'Pathlab';

/**
 * Thin wrapper over UsersService scoped to `type = pathlab` logins.
 * Each tenant has their own Pathlab role (created via POST /doctors);
 * it is resolved here so callers never pick a role.
 */
@Injectable()
export class PathlabsService {
  constructor(
    @InjectModel(User) private readonly userModel: typeof User,
    @InjectModel(Role) private readonly roleModel: typeof Role,
    private readonly usersService: UsersService,
  ) {}

  async findAll(caller: AuthUser): Promise<User[]> {
    const where: any = { type: UserType.PATHLAB };
    if (caller.doctorId) where.doctor_id = caller.doctorId;
    return this.userModel.findAll({
      where,
      order: [['created_at', 'DESC']],
    });
  }

  async create(dto: CreatePathlabDto, caller: AuthUser): Promise<User> {
    const role = await this.pathlabRole(caller.doctorId);
    return this.usersService.create(
      {
        name: dto.name,
        email: dto.email,
        password: dto.password,
        role_id: role.id,
        is_active: dto.is_active,
      } as any,
      caller,
      { type: UserType.PATHLAB },
    );
  }

  async update(id: string, dto: UpdatePathlabDto): Promise<User> {
    return this.usersService.update(id, dto as any);
  }

  async remove(id: string): Promise<void> {
    return this.usersService.remove(id);
  }

  /** Resolves the Pathlab role: tenant-specific first, global fallback. */
  private async pathlabRole(doctorId: string | null): Promise<Role> {
    const where: any = { name: PATHLAB_ROLE_NAME };
    if (doctorId) {
      where[Op.or] = [{ doctor_id: doctorId }, { doctor_id: null }];
      delete where.name; // reconstruct below
    }
    const role = await this.roleModel.findOne({
      where: doctorId
        ? {
            name: PATHLAB_ROLE_NAME,
            [Op.or]: [{ doctor_id: doctorId }, { doctor_id: null }],
          }
        : { name: PATHLAB_ROLE_NAME, doctor_id: null },
      order: [['doctor_id', 'DESC NULLS LAST']], // prefer tenant-specific
    });
    if (!role) {
      throw new AppException(ErrorCode.INTERNAL_ERROR, {
        message: 'The Pathlab role is not set up for this tenant. Please try again shortly.',
      });
    }
    return role;
  }
}
