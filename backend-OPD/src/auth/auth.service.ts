import { Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { UsersService } from '../users/users.service';
import { LoginDto } from './dto/login.dto';
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

  me(user: AuthUser): AuthUser {
    return user;
  }
}
