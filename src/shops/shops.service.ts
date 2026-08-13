import { ForbiddenException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  CustomResource,
  KubernetesService,
} from '../kubernetes/kubernetes.service';
import { CreateShopDto } from './dto/create-shop.dto';
import { ShopView } from './dto/shop-view.dto';
import { UpdateShopDto } from './dto/update-shop.dto';
import {
  ANNOTATION_DISPLAY_NAME,
  ANNOTATION_OWNER_ID,
  ANNOTATION_WALLET_ADDRESS,
  Availability,
  CRD_GROUP,
  CRD_VERSION,
  DatabaseType,
  LABEL_MANAGED_BY,
  LABEL_OWNER,
  LABEL_SHOP,
  MANAGED_BY,
  ownerHash,
  PLURAL_DISCORD,
  PLURAL_SHOPS,
  PLURAL_WALLETS,
  discordName,
  replicasFor,
  shopName,
  walletName,
} from './shop.constants';

/**
 * Orchestrates the lifecycle of a shop as three linked custom resources:
 *
 *   Shop ──walletRef──▶ Wallet
 *        └─discordChannelRef─▶ DiscordChannel
 *
 * The Wallet and DiscordChannel CRs are created first (the Shop spec requires
 * their names), then the Shop. All three carry an owner label so a user only
 * ever sees and mutates their own shops.
 */
@Injectable()
export class ShopsService {
  private readonly logger = new Logger(ShopsService.name);
  private readonly urlTemplate: string;

  constructor(
    private readonly k8s: KubernetesService,
    config: ConfigService,
  ) {
    this.urlTemplate = config.get<string>(
      'SHOP_URL_TEMPLATE',
      'http://{name}.localhost',
    );
  }

  async create(userId: string, dto: CreateShopDto): Promise<ShopView> {
    const name = shopName(dto.name, userId);
    const wallet = walletName(name);
    const discord = discordName(name);
    const owner = ownerHash(userId);
    const labels = {
      [LABEL_OWNER]: owner,
      [LABEL_MANAGED_BY]: MANAGED_BY,
      [LABEL_SHOP]: name,
    };

    // Order matters: the Shop spec references the Wallet/DiscordChannel by name,
    // so those must exist first. If any step fails we roll back what we made.
    const created: Array<{ plural: string; name: string }> = [];
    try {
      await this.k8s.create(CRD_GROUP, CRD_VERSION, PLURAL_WALLETS, {
        apiVersion: `${CRD_GROUP}/${CRD_VERSION}`,
        kind: 'Wallet',
        metadata: {
          name: wallet,
          labels,
          // WalletSpec has no address field yet (see README limitation); keep
          // the admin-supplied address as an annotation so it is not lost.
          annotations: { [ANNOTATION_WALLET_ADDRESS]: dto.walletAddress },
        },
        spec: { shopRef: name },
      });
      created.push({ plural: PLURAL_WALLETS, name: wallet });

      await this.k8s.create(CRD_GROUP, CRD_VERSION, PLURAL_DISCORD, {
        apiVersion: `${CRD_GROUP}/${CRD_VERSION}`,
        kind: 'DiscordChannel',
        metadata: { name: discord, labels },
        spec: {
          channelName: dto.discordChannelName,
          serverID: dto.discordServerId,
        },
      });
      created.push({ plural: PLURAL_DISCORD, name: discord });

      const shop = await this.k8s.create(CRD_GROUP, CRD_VERSION, PLURAL_SHOPS, {
        apiVersion: `${CRD_GROUP}/${CRD_VERSION}`,
        kind: 'Shop',
        metadata: {
          name,
          labels,
          annotations: {
            [ANNOTATION_OWNER_ID]: userId,
            [ANNOTATION_DISPLAY_NAME]: dto.name,
            [ANNOTATION_WALLET_ADDRESS]: dto.walletAddress,
          },
        },
        spec: {
          displayName: dto.name,
          availability: dto.availability,
          databaseType: dto.databaseType,
          walletRef: wallet,
          discordChannelRef: discord,
        },
      });

      return this.toView(shop);
    } catch (err) {
      await this.rollback(created);
      throw err;
    }
  }

  async list(userId: string): Promise<ShopView[]> {
    const shops = await this.k8s.list(
      CRD_GROUP,
      CRD_VERSION,
      PLURAL_SHOPS,
      `${LABEL_OWNER}=${ownerHash(userId)}`,
    );
    return shops.map((shop) => this.toView(shop));
  }

  async get(userId: string, name: string): Promise<ShopView> {
    return this.toView(await this.getOwned(userId, name));
  }

  async update(
    userId: string,
    name: string,
    dto: UpdateShopDto,
  ): Promise<ShopView> {
    const shop = await this.getOwned(userId, name);
    shop.spec = shop.spec ?? {};
    shop.metadata = shop.metadata ?? {};
    shop.metadata.annotations = shop.metadata.annotations ?? {};

    if (dto.availability !== undefined) {
      shop.spec.availability = dto.availability;
    }
    if (dto.name !== undefined) {
      shop.spec.displayName = dto.name;
      shop.metadata.annotations[ANNOTATION_DISPLAY_NAME] = dto.name;
    }
    if (dto.walletAddress !== undefined) {
      shop.metadata.annotations[ANNOTATION_WALLET_ADDRESS] = dto.walletAddress;
      // Mirror onto the Wallet CR annotation so both stay consistent.
      await this.updateWalletAddress(name, dto.walletAddress);
    }

    const updated = await this.k8s.replace(
      CRD_GROUP,
      CRD_VERSION,
      PLURAL_SHOPS,
      name,
      shop,
    );
    return this.toView(updated);
  }

  async remove(userId: string, name: string): Promise<void> {
    // Ownership check first so we never delete another user's resources.
    await this.getOwned(userId, name);
    await this.k8s.deleteIfExists(CRD_GROUP, CRD_VERSION, PLURAL_SHOPS, name);
    await this.k8s.deleteIfExists(
      CRD_GROUP,
      CRD_VERSION,
      PLURAL_WALLETS,
      walletName(name),
    );
    await this.k8s.deleteIfExists(
      CRD_GROUP,
      CRD_VERSION,
      PLURAL_DISCORD,
      discordName(name),
    );
  }

  /** Fetches a shop and asserts the caller owns it (404s are surfaced by k8s). */
  private async getOwned(
    userId: string,
    name: string,
  ): Promise<CustomResource> {
    const shop = await this.k8s.get(CRD_GROUP, CRD_VERSION, PLURAL_SHOPS, name);
    if (shop.metadata?.labels?.[LABEL_OWNER] !== ownerHash(userId)) {
      throw new ForbiddenException('You do not own this shop');
    }
    return shop;
  }

  private async updateWalletAddress(
    shop: string,
    address: string,
  ): Promise<void> {
    const wallet = await this.k8s.get(
      CRD_GROUP,
      CRD_VERSION,
      PLURAL_WALLETS,
      walletName(shop),
    );
    wallet.metadata = wallet.metadata ?? {};
    wallet.metadata.annotations = wallet.metadata.annotations ?? {};
    wallet.metadata.annotations[ANNOTATION_WALLET_ADDRESS] = address;
    await this.k8s.replace(
      CRD_GROUP,
      CRD_VERSION,
      PLURAL_WALLETS,
      walletName(shop),
      wallet,
    );
  }

  private async rollback(
    created: Array<{ plural: string; name: string }>,
  ): Promise<void> {
    for (const { plural, name } of created.reverse()) {
      await this.k8s.deleteIfExists(CRD_GROUP, CRD_VERSION, plural, name);
    }
  }

  private toView(shop: CustomResource): ShopView {
    const spec = shop.spec ?? {};
    const status = shop.status ?? {};
    const annotations = shop.metadata?.annotations ?? {};
    const name = shop.metadata?.name ?? '';

    return {
      name,
      displayName:
        (spec.displayName as string) ??
        annotations[ANNOTATION_DISPLAY_NAME] ??
        name,
      availability: (spec.availability as Availability) ?? 'standard',
      databaseType: (spec.databaseType as DatabaseType) ?? 'standard',
      walletAddress: annotations[ANNOTATION_WALLET_ADDRESS] ?? '',
      walletRef: (spec.walletRef as string) ?? '',
      discordChannelRef: (spec.discordChannelRef as string) ?? '',
      ready: (status.ready as boolean) ?? false,
      replicas:
        (status.replicas as number) ??
        replicasFor((spec.availability as Availability) ?? 'standard'),
      url: this.urlTemplate.replace('{name}', name),
      createdAt: shop.metadata?.creationTimestamp,
    };
  }
}
