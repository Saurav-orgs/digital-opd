import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsEmail,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

/**
 * The super admin opens an account for a doctor.
 *
 * Only a name, an address and — normally — a plan: everything about the
 * practice is left for the doctor's own first sign-in, which is the same
 * screen a doctor who paid online meets. The password is not here because
 * nobody should be typing somebody else's; the server makes one and mails it.
 */
export class InviteDoctorDto {
  @ApiProperty({ example: 'Dr. Asha Menon' })
  @IsString()
  @MinLength(2, { message: "Please enter the doctor's name." })
  @MaxLength(120)
  name: string;

  @ApiProperty({ example: 'dr.asha@hospital.com' })
  @IsEmail({}, { message: 'Please enter a valid email address.' })
  email: string;

  /**
   * The plan to map to the account. Optional, because an account is sometimes
   * opened before the plan is agreed — but until one is mapped the doctor
   * cannot sign in, and both the mail and the Doctors screen say so.
   */
  @ApiPropertyOptional({ description: "The plan's id. It may be an inactive plan." })
  @IsOptional()
  @IsUUID('4', { message: 'Please choose a plan.' })
  plan_id?: string;

  @ApiPropertyOptional({ description: "How many months to give. Defaults to the plan's own cycle." })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1, { message: 'Give at least 1 month.' })
  @Max(60)
  months?: number;

  @ApiPropertyOptional({ example: 'Onboarded on the call; invoiced offline.' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}
