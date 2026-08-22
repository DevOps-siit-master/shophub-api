import { ForbiddenException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import {
  CustomResource,
  KubernetesService,
} from '../kubernetes/kubernetes.service';
import { CreateShopDto } from './dto/create-shop.dto';
import {
  ANNOTATION_DISPLAY_NAME,
  ANNOTATION_OWNER_ID,
  LABEL_MANAGED_BY,
  LABEL_OWNER,
  MANAGED_BY,
  ownerHash,
  PLURAL_SHOPS,
  shopName,
} from './shop.constants';
import { ShopsService } from './shops.service';

const USER = 'user-123';

const createDto: CreateShopDto = {
  name: 'Healthy Food',
  availability: 'high',
  databaseType: 'standard',
  walletAddress: '0xabc',
  discordChannelName: 'orders',
  discordServerId: '999',
};

/** A Shop CR owned by USER, used as the k8s.get result in update/remove tests. */
const ownedShop = (): CustomResource => ({
  metadata: {
    name: 'healthy-food-abc',
    labels: { [LABEL_OWNER]: ownerHash(USER) },
    annotations: {},
  },
  spec: {
    displayName: 'Healthy Food',
    availability: 'standard',
    databaseType: 'standard',
    wallet: { address: '0xold' },
  },
});

/** A Shop CR owned by a different user. */
const foreignShop = (): CustomResource => ({
  metadata: { name: 'x', labels: { [LABEL_OWNER]: 'someone-else' } },
});

describe('ShopsService', () => {
  let service: ShopsService;
  let k8s: jest.Mocked<
    Pick<
      KubernetesService,
      'create' | 'list' | 'get' | 'replace' | 'delete' | 'deleteIfExists'
    >
  >;

  beforeEach(async () => {
    k8s = {
      create: jest.fn((_g, _v, _p, body: CustomResource) =>
        Promise.resolve(body),
      ),
      list: jest.fn(),
      get: jest.fn(),
      replace: jest.fn((_g, _v, _p, _n, body: CustomResource) =>
        Promise.resolve(body),
      ),
      delete: jest.fn(),
      deleteIfExists: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ShopsService,
        { provide: KubernetesService, useValue: k8s },
        {
          provide: ConfigService,
          useValue: { get: () => 'http://{name}.test' },
        },
      ],
    }).compile();

    service = module.get<ShopsService>(ShopsService);
  });

  describe('create', () => {
    it('creates a single Shop CR with inline wallet and discord config', async () => {
      const view = await service.create(USER, createDto);

      // Only the Shop is created; the operator owns the Wallet/DiscordChannel.
      const plurals = k8s.create.mock.calls.map((c) => c[2]);
      expect(plurals).toEqual([PLURAL_SHOPS]);

      const shopBody = k8s.create.mock.calls[0][3];
      expect(shopBody.spec?.wallet).toEqual({ address: '0xabc' });
      expect(shopBody.spec?.discordChannel).toEqual({
        channelName: 'orders',
        serverID: '999',
      });
      expect(view.walletAddress).toBe('0xabc');
      expect(view.replicas).toBe(3); // high → 3
      expect(view.url).toBe(`http://${view.name}.test`);
    });

    it('stamps owner scoping metadata and a derived, owner-unique name', async () => {
      await service.create(USER, createDto);
      const body = k8s.create.mock.calls[0][3];

      expect(body.metadata?.name).toBe(shopName(createDto.name, USER));
      expect(body.metadata?.labels?.[LABEL_OWNER]).toBe(ownerHash(USER));
      expect(body.metadata?.labels?.[LABEL_MANAGED_BY]).toBe(MANAGED_BY);
      expect(body.metadata?.annotations?.[ANNOTATION_OWNER_ID]).toBe(USER);
      expect(body.metadata?.annotations?.[ANNOTATION_DISPLAY_NAME]).toBe(
        createDto.name,
      );
      expect(body.spec?.databaseType).toBe('standard');
    });
  });

  describe('list', () => {
    it('lists only the caller shops via owner label selector', async () => {
      k8s.list.mockResolvedValue([]);
      await service.list(USER);
      expect(k8s.list).toHaveBeenCalledWith(
        expect.any(String),
        expect.any(String),
        PLURAL_SHOPS,
        `${LABEL_OWNER}=${ownerHash(USER)}`,
      );
    });

    it('maps every returned CR to a view', async () => {
      k8s.list.mockResolvedValue([ownedShop(), ownedShop()]);
      const views = await service.list(USER);
      expect(views).toHaveLength(2);
      expect(views[0].displayName).toBe('Healthy Food');
    });
  });

  describe('ownership', () => {
    it('rejects reading a shop owned by another user', async () => {
      k8s.get.mockResolvedValue(foreignShop());
      await expect(service.get(USER, 'x')).rejects.toBeInstanceOf(
        ForbiddenException,
      );
    });
  });

  describe('update', () => {
    it('applies only the provided fields and leaves the rest untouched', async () => {
      k8s.get.mockResolvedValue(ownedShop());

      const view = await service.update(USER, 'healthy-food-abc', {
        availability: 'high',
      });

      const body = k8s.replace.mock.calls[0][4];
      expect(body.spec?.availability).toBe('high');
      expect(body.spec?.wallet).toEqual({ address: '0xold' }); // untouched
      expect(body.spec?.displayName).toBe('Healthy Food'); // untouched
      expect(view.availability).toBe('high');
      expect(view.replicas).toBe(3);
    });

    it('merges the wallet address without dropping other wallet fields', async () => {
      const shop = ownedShop();
      (shop.spec as Record<string, unknown>).wallet = {
        address: '0xold',
        network: 'sepolia',
      };
      k8s.get.mockResolvedValue(shop);

      await service.update(USER, 'healthy-food-abc', {
        walletAddress: '0xnew',
      });

      const body = k8s.replace.mock.calls[0][4];
      expect(body.spec?.wallet).toEqual({
        address: '0xnew',
        network: 'sepolia',
      });
    });

    it('updates the display name in both spec and annotation', async () => {
      k8s.get.mockResolvedValue(ownedShop());

      await service.update(USER, 'healthy-food-abc', { name: 'Fresh Food' });

      const body = k8s.replace.mock.calls[0][4];
      expect(body.spec?.displayName).toBe('Fresh Food');
      expect(body.metadata?.annotations?.[ANNOTATION_DISPLAY_NAME]).toBe(
        'Fresh Food',
      );
    });

    it('replaces under the caller-supplied resource name', async () => {
      k8s.get.mockResolvedValue(ownedShop());

      await service.update(USER, 'healthy-food-abc', { availability: 'high' });

      expect(k8s.replace).toHaveBeenCalledWith(
        expect.any(String),
        expect.any(String),
        PLURAL_SHOPS,
        'healthy-food-abc',
        expect.any(Object),
      );
    });

    it('tolerates a Shop with no spec/metadata/annotations', async () => {
      k8s.get.mockResolvedValue({
        metadata: { name: 'bare', labels: { [LABEL_OWNER]: ownerHash(USER) } },
      });

      await service.update(USER, 'bare', {
        name: 'New',
        walletAddress: '0xnew',
      });

      const body = k8s.replace.mock.calls[0][4];
      expect(body.spec?.displayName).toBe('New');
      expect(body.spec?.wallet).toEqual({ address: '0xnew' });
      expect(body.metadata?.annotations?.[ANNOTATION_DISPLAY_NAME]).toBe('New');
    });

    it('refuses to update a shop owned by someone else', async () => {
      k8s.get.mockResolvedValue(foreignShop());

      await expect(
        service.update(USER, 'x', { availability: 'high' }),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(k8s.replace).not.toHaveBeenCalled();
    });
  });

  describe('remove', () => {
    it('deletes an owned shop by name', async () => {
      k8s.get.mockResolvedValue(ownedShop());

      await service.remove(USER, 'healthy-food-abc');

      expect(k8s.deleteIfExists).toHaveBeenCalledWith(
        expect.any(String),
        expect.any(String),
        PLURAL_SHOPS,
        'healthy-food-abc',
      );
    });

    it('refuses to delete a shop owned by someone else', async () => {
      k8s.get.mockResolvedValue(foreignShop());

      await expect(service.remove(USER, 'x')).rejects.toBeInstanceOf(
        ForbiddenException,
      );
      expect(k8s.deleteIfExists).not.toHaveBeenCalled();
    });
  });

  describe('toView', () => {
    it('surfaces the admin wallet address from spec.wallet.address', async () => {
      k8s.get.mockResolvedValue({
        metadata: { name: 'x', labels: { [LABEL_OWNER]: ownerHash(USER) } },
        spec: {
          availability: 'standard',
          databaseType: 'light',
          wallet: { address: '0xdeadbeef' },
        },
      });
      const view = await service.get(USER, 'x');
      expect(view.walletAddress).toBe('0xdeadbeef');
      expect(view.databaseType).toBe('light');
    });

    it('prefers live status over spec-derived defaults', async () => {
      k8s.get.mockResolvedValue({
        metadata: { name: 'x', labels: { [LABEL_OWNER]: ownerHash(USER) } },
        spec: { availability: 'standard' },
        status: { ready: true, replicas: 5 },
      });
      const view = await service.get(USER, 'x');
      expect(view.ready).toBe(true);
      expect(view.replicas).toBe(5); // status wins over replicasFor('standard')=2
    });

    it('falls back to safe defaults when spec and status are empty', async () => {
      k8s.get.mockResolvedValue({
        metadata: {
          name: 'bare-shop',
          labels: { [LABEL_OWNER]: ownerHash(USER) },
        },
      });
      const view = await service.get(USER, 'bare-shop');
      expect(view.availability).toBe('standard');
      expect(view.databaseType).toBe('standard');
      expect(view.walletAddress).toBe('');
      expect(view.ready).toBe(false);
      expect(view.replicas).toBe(2); // replicasFor('standard')
      expect(view.displayName).toBe('bare-shop'); // falls back to CR name
      expect(view.url).toBe('http://bare-shop.test');
    });

    it('uses the display-name annotation when spec.displayName is absent', async () => {
      k8s.get.mockResolvedValue({
        metadata: {
          name: 'x',
          labels: { [LABEL_OWNER]: ownerHash(USER) },
          annotations: { [ANNOTATION_DISPLAY_NAME]: 'Annotated Name' },
        },
        spec: { availability: 'high' },
      });
      const view = await service.get(USER, 'x');
      expect(view.displayName).toBe('Annotated Name');
      expect(view.replicas).toBe(3); // replicasFor('high')
    });
  });
});
