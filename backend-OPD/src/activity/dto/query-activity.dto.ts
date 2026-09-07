import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsInt, IsOptional, IsString, IsUUID, Max, Min } from 'class-validator';
import { Type } from 'class-transformer';
import { ActivityAction, ActivityActor } from '../../common/enums';

export class QueryActivityDto {
  @ApiPropertyOptional({ enum: ActivityAction, description: 'Exact action to filter by.' })
  @IsOptional()
  @IsEnum(ActivityAction)
  action?: ActivityAction;

  @ApiPropertyOptional({ enum: ActivityActor })
  @IsOptional()
  @IsEnum(ActivityActor)
  actor_type?: ActivityActor;

  @ApiPropertyOptional({ description: 'Only activity by this user or patient account.' })
  @IsOptional()
  @IsUUID()
  actor_id?: string;

  @ApiPropertyOptional({ description: "Everything that happened to one record, e.g. 'appointment'." })
  @IsOptional()
  @IsString()
  entity_type?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  entity_id?: string;

  @ApiPropertyOptional({ description: 'ISO date, inclusive.', example: '2026-09-01' })
  @IsOptional()
  @IsString()
  from?: string;

  @ApiPropertyOptional({ description: 'ISO date, inclusive.', example: '2026-09-30' })
  @IsOptional()
  @IsString()
  to?: string;

  @ApiPropertyOptional({ default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  // Capped: this table is the largest in the schema and kept forever, so an
  // unbounded page size is a way to ask it for everything by accident.
  @ApiPropertyOptional({ default: 50, maximum: 200 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  limit?: number = 50;
}
