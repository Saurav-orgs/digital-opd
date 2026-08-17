import { ApiProperty } from '@nestjs/swagger';
import { MaxLength, MinLength } from 'class-validator';

/** Patient self-upload — mobile comes from the patient's own session. */
export class CreateOwnReportDto {
  @ApiProperty({ example: 'Blood Test — CBC' })
  @MinLength(2, { message: 'Please enter a title for this report.' })
  @MaxLength(200)
  title: string;
}
