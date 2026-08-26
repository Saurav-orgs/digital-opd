import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, Matches, MaxLength } from 'class-validator';

export class BlockNumberDto {
  @ApiProperty({ example: '9876543210' })
  @Matches(/^[6-9]\d{9}$/, {
    message: 'Please enter a valid 10-digit mobile number.',
  })
  mobile: string;

  @ApiPropertyOptional({ example: 'Repeated no-shows' })
  @IsOptional()
  @IsString()
  @MaxLength(300)
  reason?: string;
}
