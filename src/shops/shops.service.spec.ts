import { ForbiddenException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import {
  CustomResource,
  KubernetesService,
} from '../kubernetes/kubernetes.service';
import { CreateShopDto } from './dto/create-shop.dto';
import { LABEL_OWNER, ownerHash, PLURAL_SHOPS } from './shop.constants';
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

  it('rejects access to a shop owned by another user', async () => {
    k8s.get.mockResolvedValue({
      metadata: { name: 'x', labels: { [LABEL_OWNER]: 'someone-else' } },
    });
    await expect(service.get(USER, 'x')).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('surfaces the admin wallet address from spec.wallet.address', async () => {
    k8s.get.mockResolvedValue({
      metadata: {
        name: 'x',
        labels: { [LABEL_OWNER]: ownerHash(USER) },
      },
      spec: {
        availability: 'standard',
        databaseType: 'light',
        wallet: { address: '0xdeadbeef' },
      },
    });
    const view = await service.get(USER, 'x');
    expect(view.walletAddress).toBe('0xdeadbeef');
  });
});
