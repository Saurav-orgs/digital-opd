import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, Matches, MaxLength } from 'class-validator';

/**
 * The issuer block stamped onto every subscription invoice. All optional:
 * the fields that are filled in are printed, the rest are left off, so the
 * platform can start selling before the GST registration is in hand.
 */
export class UpdateInvoiceSettingsDto {
  @ApiPropertyOptional({ example: 'Impulsive Web Private Limited' })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  invoice_legal_name?: string;

  @ApiPropertyOptional({ example: '4th Floor, Tower B, Sector 62, Noida, Uttar Pradesh 201301' })
  @IsOptional()
  @IsString()
  @MaxLength(400)
  invoice_address?: string;

  @ApiPropertyOptional({ example: '09AAACT1234C1ZS' })
  @IsOptional()
  @IsString()
  @MaxLength(20)
  @Matches(/^$|^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][0-9A-Z]Z[0-9A-Z]$/i, {
    message: 'Enter a valid 15-character GSTIN, or leave it blank.',
  })
  invoice_gstin?: string;

  @ApiPropertyOptional({ example: 'AAACT1234C' })
  @IsOptional()
  @IsString()
  @MaxLength(10)
  @Matches(/^$|^[A-Z]{5}[0-9]{4}[A-Z]$/i, {
    message: 'Enter a valid 10-character PAN, or leave it blank.',
  })
  invoice_pan?: string;

  @ApiPropertyOptional({ example: 'Uttar Pradesh' })
  @IsOptional()
  @IsString()
  @MaxLength(60)
  invoice_state?: string;

  @ApiPropertyOptional({ example: 'billing@mydigitalopd.com' })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  invoice_email?: string;

  @ApiPropertyOptional({ example: '+91 98765 43210' })
  @IsOptional()
  @IsString()
  @MaxLength(40)
  invoice_phone?: string;

  /** The letters an invoice number starts with: MDO in MDO/2026-27/0007. */
  @ApiPropertyOptional({ example: 'MDO' })
  @IsOptional()
  @IsString()
  @MaxLength(8)
  @Matches(/^$|^[A-Za-z0-9]{2,8}$/, {
    message: 'Use 2 to 8 letters or digits for the invoice prefix.',
  })
  invoice_prefix?: string;
}

export class UpdateSettingsDto extends UpdateInvoiceSettingsDto {
  /**
   * Base URL of the patient portal. Every doctor's booking link and QR is
   * built from this plus their slug, so it has to be an address a patient's
   * phone can actually reach — not localhost.
   */
  @ApiPropertyOptional({ example: 'https://booking.myclinic.com' })
  @IsOptional()
  @IsString()
  @MaxLength(300)
  @Matches(/^https?:\/\/.+/i, {
    message: 'Enter a full URL starting with http:// or https://',
  })
  patient_web_base?: string;
}
