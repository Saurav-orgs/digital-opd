import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import { User } from '../database/models/user.model';
import { Role } from '../database/models/role.model';
import { UsersService } from '../users/users.service';
import { CreatePathlabDto, UpdatePathlabDto } from './dto/pathlab.dto';
import { UserType } from '../common/enums';
import { AppException } from '../common/errors/app.exception';
import { ErrorCode } from '../common/errors/error-codes';

const PATHLAB_ROLE_NAME = 'Pathlab';

/**
 * Thin wrapper over UsersService scoped to `type = pathlab` logins. The
 * Pathlab role (reports:create + reports:read only) is seeded once by
 * MasterSetupService and resolved here so callers never pick a role.
 */
@Injectable()
export class PathlabsService {
  constructor(
    @InjectModel(User) private readonly userModel: typeof User,
    @InjectModel(Role) private readonly roleModel: typeof Role,
    private readonly usersService: UsersService,
  ) {}

  async findAll(): Promise<User[]> {
    return this.userModel.findAll({
      where: { type: UserType.PATHLAB },
      order: [['created_at', 'DESC']],
    });
  }

  async create(dto: CreatePathlabDto): Promise<User> {
    const role = await this.pathlabRole();
    return this.usersService.create(
      {
        name: dto.name,
        email: dto.email,
        password: dto.password,
        role_id: role.id,
        is_active: dto.is_active,
      } as any,
      { type: UserType.PATHLAB },
    );
  }

  async update(id: string, dto: UpdatePathlabDto): Promise<User> {
    return this.usersService.update(id, dto as any);
  }

  async remove(id: string): Promise<void> {
    return this.usersService.remove(id);
  }

  private async pathlabRole(): Promise<Role> {
    const role = await this.roleModel.findOne({
      where: { name: PATHLAB_ROLE_NAME },
    });
    if (!role) {
      throw new AppException(ErrorCode.INTERNAL_ERROR, {
        message: 'The Pathlab role is not set up yet. Please try again shortly.',
      });
    }
    return role;
  }
}
