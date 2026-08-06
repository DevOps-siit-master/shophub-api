import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';
import { AVAILABILITIES } from '../shop.constants';
import type { Availability } from '../shop.constants';

/**
 * Reconfigurable shop fields (spec 1.2: admin may change availability or the
 * wallet address). The database tier is intentionally immutable — switching it
 * would require migrating the shop's data.
 */
export class UpdateShopDto {
  @ApiPropertyOptional({
    example: 'Healthy Food Store',
    description: 'New human-readable shop name',
    maxLength: 40,
  })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(40)
  name?: string;

  @ApiPropertyOptional({
    enum: AVAILABILITIES,
    description: 'New availability tier: standard (2 replicas) or high (3)',
  })
  @IsOptional()
  @IsIn(AVAILABILITIES)
  availability?: Availability;

  @ApiPropertyOptional({
    example: '0x1234abcd...',
    description: 'New wallet address that receives customer payments',
  })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(128)
  walletAddress?: string;
}
