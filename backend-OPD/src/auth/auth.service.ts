import { Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { UsersService } from '../users/users.service';
import { LoginDto } from './dto/login.dto';
import { ChangePasswordDto } from './dto/change-password.dto';
import { AppException } from '../common/errors/app.exception';
import { ErrorCode } from '../common/errors/error-codes';
import { AuthUser } from '../common/decorators/current-user.decorator';

@Injectable()
export class AuthService {
  constructor(
    private readonly usersService: UsersService,
    private readonly jwtService: JwtService,
  ) {}

  async login(dto: LoginDto) {
    const user = await this.usersService.findForAuth(dto.email);
    // Uniform message whether email is unknown or password is wrong.
    if (!user) throw new AppException(ErrorCode.INVALID_CREDENTIALS);

    const ok = await bcrypt.compare(dto.password, user.password_hash);
    if (!ok) throw new AppException(ErrorCode.INVALID_CREDENTIALS);

    if (!user.is_active) throw new AppException(ErrorCode.ACCOUNT_DISABLED);

    const principal = UsersService.toAuthUser(user);

    const token = await this.jwtService.signAsync({
      sub: user.id,
      email: user.email,
      type: user.type,
    });

    return {
      accessToken: token,
      user: principal,
    };
  }

  /**
   * Rotate your own password.
   *
   * The current password is required even though the caller is already
   * authenticated: a token left open on a shared clinic machine should not be
   * enough to lock the real owner out of their account.
   */
  async changePassword(user: AuthUser, dto: ChangePasswordDto): Promise<void> {
    const row = await this.usersService.findForAuth(user.email);
    if (!row) throw new AppException(ErrorCode.UNAUTHORIZED);

    const ok = await bcrypt.compare(dto.current_password, row.password_hash);
    if (!ok) {
      throw new AppException(ErrorCode.INVALID_CREDENTIALS, {
        message: 'Your current password is incorrect.',
      });
    }
    if (dto.current_password === dto.new_password) {
      throw new AppException(ErrorCode.BAD_REQUEST, {
        message: 'The new password must be different from the current one.',
      });
    }

    await this.usersService.setPassword(row.id, dto.new_password);
  }

  me(user: AuthUser): AuthUser {
    return user;
  }
}
