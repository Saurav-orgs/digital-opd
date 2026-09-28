import { Body, Controller, Get, Post } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AuthService } from './auth.service';
import { LoginDto } from './dto/login.dto';
import { ChangePasswordDto } from './dto/change-password.dto';
import { ConfirmEmailCodeDto, SendEmailCodeDto } from './dto/email-verification.dto';
import {
  ForgotPasswordDto,
  ResetPasswordDto,
  VerifyResetCodeDto,
} from './dto/password-reset.dto';
import { Public } from '../common/decorators/public.decorator';
import { AllowsTemporaryPassword } from '../common/decorators/temporary-password.decorator';
import { CurrentUser, AuthUser } from '../common/decorators/current-user.decorator';

@ApiTags('Auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Public()
  @Post('login')
  @ApiOperation({ summary: 'Admin/doctor login → JWT' })
  login(@Body() dto: LoginDto) {
    return this.authService.login(dto);
  }

  // ── Email verification at sign-up ─────────────────────────

  @Public()
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post('email-verification/send')
  @ApiOperation({ summary: 'Email a 6-digit code to an address about to register' })
  sendEmailCode(@Body() dto: SendEmailCodeDto) {
    return this.authService.sendEmailCode(dto);
  }

  @Public()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post('email-verification/confirm')
  @ApiOperation({ summary: 'Check the code; the address is then accepted by /doctors/register' })
  confirmEmailCode(@Body() dto: ConfirmEmailCodeDto) {
    return this.authService.confirmEmailCode(dto);
  }

  // ── Forgot / reset password ───────────────────────────────

  @Public()
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post('forgot-password')
  @ApiOperation({ summary: 'Email a 6-digit password-reset code (always 200)' })
  forgotPassword(@Body() dto: ForgotPasswordDto) {
    return this.authService.forgotPassword(dto);
  }

  @Public()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post('forgot-password/verify')
  @ApiOperation({ summary: 'Check the code → a short-lived token for /reset-password' })
  verifyResetCode(@Body() dto: VerifyResetCodeDto) {
    return this.authService.verifyResetCode(dto);
  }

  @Public()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post('reset-password')
  @ApiOperation({ summary: 'Set a new password with the token from /forgot-password/verify' })
  resetPassword(@Body() dto: ResetPasswordDto) {
    return this.authService.resetPassword(dto);
  }

  @Post('change-password')
  @ApiBearerAuth()
  // Reachable on a temporary password — it is the way out of one.
  @AllowsTemporaryPassword()
  @ApiOperation({ summary: 'Change your own password (requires the current one)' })
  async changePassword(
    @CurrentUser() user: AuthUser,
    @Body() dto: ChangePasswordDto,
  ) {
    await this.authService.changePassword(user, dto);
    return { ok: true };
  }

  @Get('me')
  @ApiBearerAuth()
  // The app asks this on every load, including the load that shows the
  // change-password screen, so it has to answer on a temporary password.
  @AllowsTemporaryPassword()
  @ApiOperation({ summary: 'Current authenticated principal + permissions' })
  me(@CurrentUser() user: AuthUser) {
    return this.authService.me(user);
  }
}
