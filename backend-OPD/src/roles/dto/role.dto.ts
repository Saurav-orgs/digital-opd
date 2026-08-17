import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import {
  ArrayUnique,
  IsArray,
  IsOptional,
  IsString,
  IsUUID,
  MinLength,
} from 'class-validator';

export class CreateRoleDto {
  @ApiProperty({ example: 'Front-desk' })
  @IsString()
  @MinLength(2, { message: 'Role name must be at least 2 characters.' })
  name: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  description?: string;

  @ApiProperty({
    type: [String],
    description: 'Permission ids granted to this role.',
    example: [],
  })
  @IsArray()
  @ArrayUnique()
  @IsUUID('4', { each: true, message: 'Each permission must be a valid id.' })
  permissionIds: string[];
}

export class UpdateRoleDto extends PartialType(CreateRoleDto) {}
