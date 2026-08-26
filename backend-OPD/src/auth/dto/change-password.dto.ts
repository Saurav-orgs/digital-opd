import { ApiProperty } from '@nestjs/swagger';
import { IsString, MaxLength, MinLength } from 'class-validator';

/** Any signed-in user rotating their own password. */
export class ChangePasswordDto {
  @ApiProperty({ example: 'currentPass123' })
  @IsString()
  @MinLength(1, { message: 'Please enter your current password.' })
  current_password: string;

  @ApiProperty({ example: 'NewPass@2026', minLength: 8 })
  @IsString()
  @MinLength(8, { message: 'New password must be at least 8 characters.' })
  @MaxLength(128)
  new_password: string;
}
