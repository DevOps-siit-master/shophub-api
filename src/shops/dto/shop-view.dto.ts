import { ApiProperty } from '@nestjs/swagger';
import type { Availability, DatabaseType } from '../shop.constants';

/**
 * Projection of a Shop custom resource returned to the ShopHub frontend. It
 * flattens the parts of the CR the UI cares about (spec + observed status).
 */
export class ShopView {
  @ApiProperty({ description: 'Shop CR name — the stable id used in URLs' })
  name: string;

  @ApiProperty({ description: 'Human-readable shop name' })
  displayName: string;

  @ApiProperty({ enum: ['standard', 'high'] })
  availability: Availability;

  @ApiProperty({ enum: ['standard', 'light'] })
  databaseType: DatabaseType;

  @ApiProperty({
    description: 'Wallet address configured to receive payments (admin input)',
  })
  walletAddress: string;

  @ApiProperty({ description: 'Referenced Wallet CR name' })
  walletRef: string;

  @ApiProperty({ description: 'Referenced DiscordChannel CR name' })
  discordChannelRef: string;

  @ApiProperty({
    description: 'Whether the operator reports the shop as ready',
  })
  ready: boolean;

  @ApiProperty({ description: 'Observed number of running replicas' })
  replicas: number;

  @ApiProperty({ description: 'Public URL of the deployed shop' })
  url: string;

  @ApiProperty({ description: 'CR creation timestamp', required: false })
  createdAt?: string;
}
