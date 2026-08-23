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
  Availability,
  CRD_GROUP,
  CRD_VERSION,
  DatabaseType,
  LABEL_MANAGED_BY,
  LABEL_OWNER,
  MANAGED_BY,
  ownerHash,
  PLURAL_SHOPS,
  replicasFor,
  shopName,
} from './shop.constants';

/**
 * Manages shop sites as a single Shop custom resource. The shop-operator's
 * ShopReconciler owns creating the Wallet and DiscordChannel children (via owner
 * references) from the Shop's inline config, so this service only ever creates,
 * reads, updates and deletes the Shop itself — Kubernetes cascade-deletes the
 * children with it. Every Shop carries an owner label so a user only ever sees
 * and mutates their own shops.
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
    const labels = {
      [LABEL_OWNER]: ownerHash(userId),
      [LABEL_MANAGED_BY]: MANAGED_BY,
    };

    // A single Shop create. The operator materialises the owned Wallet and
    // DiscordChannel from the inline config below, so there is nothing to roll
    // back if this call fails: either the Shop exists or nothing does.
    const shop = await this.k8s.create(CRD_GROUP, CRD_VERSION, PLURAL_SHOPS, {
      apiVersion: `${CRD_GROUP}/${CRD_VERSION}`,
      kind: 'Shop',
      metadata: {
        name,
        labels,
        annotations: {
          [ANNOTATION_OWNER_ID]: userId,
          [ANNOTATION_DISPLAY_NAME]: dto.name,
        },
      },
      spec: {
        displayName: dto.name,
        availability: dto.availability,
        databaseType: dto.databaseType,
        wallet: { address: dto.walletAddress },
        discordChannel: {
          channelName: dto.discordChannelName,
          serverID: dto.discordServerId,
        },
      },
    });

    return this.toView(shop);
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
    // getOwned() only returns shops whose metadata.labels matched, so metadata
    // is always present here — the fallback is purely defensive.
    /* istanbul ignore next */
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
      // The operator propagates this onto the owned Wallet on the next reconcile.
      shop.spec.wallet = {
        ...(shop.spec.wallet ?? {}),
        address: dto.walletAddress,
      };
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
    // Deleting the Shop cascade-deletes the operator-owned Wallet and
    // DiscordChannel via their owner references.
    await this.k8s.deleteIfExists(CRD_GROUP, CRD_VERSION, PLURAL_SHOPS, name);
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

  private toView(shop: CustomResource): ShopView {
    const spec = shop.spec ?? {};
    const status = shop.status ?? {};
    const annotations = shop.metadata?.annotations ?? {};
    const name = shop.metadata?.name ?? '';
    const wallet = (spec.wallet as { address?: string } | undefined) ?? {};

    return {
      name,
      displayName:
        (spec.displayName as string) ??
        annotations[ANNOTATION_DISPLAY_NAME] ??
        name,
      availability: (spec.availability as Availability) ?? 'standard',
      databaseType: (spec.databaseType as DatabaseType) ?? 'standard',
      walletAddress: wallet.address ?? '',
      ready: (status.ready as boolean) ?? false,
      replicas:
        (status.replicas as number) ??
        replicasFor((spec.availability as Availability) ?? 'standard'),
      url: this.urlTemplate.replace('{name}', name),
      createdAt: shop.metadata?.creationTimestamp,
    };
  }
}
