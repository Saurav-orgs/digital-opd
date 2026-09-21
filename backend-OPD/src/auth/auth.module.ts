import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { AuthService } from './auth.service';
import { AuthController } from './auth.controller';
import { JwtStrategy } from './jwt.strategy';
import { UsersModule } from '../users/users.module';
import { SequelizeModule } from '@nestjs/sequelize';
import { EmailVerification } from '../database/models/email-verification.model';
import { PasswordReset } from '../database/models/password-reset.model';

@Module({
  imports: [
    UsersModule,
    PassportModule,
    SequelizeModule.forFeature([EmailVerification, PasswordReset]),
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        secret: config.get('jwt').secret,
        signOptions: { expiresIn: config.get('jwt').expiresIn },
      }),
    }),
  ],
  controllers: [AuthController],
  providers: [AuthService, JwtStrategy],
  // JwtModule goes out too, so the consultation socket verifies the same
  // tokens with the same secret instead of registering a second copy.
  exports: [AuthService, JwtModule],
})
export class AuthModule {}
