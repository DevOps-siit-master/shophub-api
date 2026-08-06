import { ApiProperty } from '@nestjs/swagger';
import {
  IsIn,
  IsNotEmpty,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';
import { AVAILABILITIES, DATABASE_TYPES } from '../shop.constants';
import type { Availability, DatabaseType } from '../shop.constants';

export class CreateShopDto {
  @ApiProperty({
    example: 'Healthy Food Store',
    description: 'Human-readable shop name shown in the ShopHub UI',
    minLength: 1,
    maxLength: 40,
  })
  @IsString()
  @MinLength(1)
  @MaxLength(40)
  name: string;

  @ApiProperty({
    enum: AVAILABILITIES,
    example: 'standard',
    description: 'App availability tier: standard (2 replicas) or high (3)',
  })
  @IsIn(AVAILABILITIES)
  availability: Availability;

  @ApiProperty({
    enum: DATABASE_TYPES,
    example: 'standard',
    description: 'Database tier: standard (PostgreSQL / CNPG) or light (Redis)',
  })
  @IsIn(DATABASE_TYPES)
  databaseType: DatabaseType;

  @ApiProperty({
    example: '0x1234abcd...',
    description: 'Wallet address that receives customer payments for this shop',
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(128)
  walletAddress: string;

  @ApiProperty({
    example: 'healthy-food-orders',
    description: 'Discord channel name for order/alert notifications',
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  discordChannelName: string;

  @ApiProperty({
    example: '123456789012345678',
    description: 'Discord server (guild) id the channel belongs to',
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(64)
  discordServerId: string;
}
