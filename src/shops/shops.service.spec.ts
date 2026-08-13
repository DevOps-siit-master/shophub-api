import { ForbiddenException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import {
  CustomResource,
  KubernetesService,
} from '../kubernetes/kubernetes.service';
import { CreateShopDto } from './dto/create-shop.dto';
import {
  ANNOTATION_WALLET_ADDRESS,
  LABEL_OWNER,
  ownerHash,
  PLURAL_DISCORD,
  PLURAL_SHOPS,
  PLURAL_WALLETS,
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

  it('creates Wallet, DiscordChannel and Shop CRs in order', async () => {
    const view = await service.create(USER, createDto);

    const plurals = k8s.create.mock.calls.map((c) => c[2]);
    expect(plurals).toEqual([PLURAL_WALLETS, PLURAL_DISCORD, PLURAL_SHOPS]);

    // Shop references the wallet/discord it just created.
    const shopBody = k8s.create.mock.calls[2][3];
    expect(shopBody.spec?.walletRef).toBe(view.walletRef);
    expect(shopBody.spec?.discordChannelRef).toBe(view.discordChannelRef);
    expect(view.replicas).toBe(3); // high → 3
    expect(view.url).toBe(`http://${view.name}.test`);
  });

  it('rolls back created resources when Shop creation fails', async () => {
    k8s.create
      .mockImplementationOnce((_g, _v, _p, body: CustomResource) =>
        Promise.resolve(body),
      )
      .mockImplementationOnce((_g, _v, _p, body: CustomResource) =>
        Promise.resolve(body),
      )
      .mockRejectedValueOnce(new Error('shop boom'));

    await expect(service.create(USER, createDto)).rejects.toThrow('shop boom');
    // Wallet + DiscordChannel cleaned up.
    expect(k8s.deleteIfExists).toHaveBeenCalledTimes(2);
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

  it('surfaces the admin wallet address from annotations', async () => {
    k8s.get.mockResolvedValue({
      metadata: {
        name: 'x',
        labels: { [LABEL_OWNER]: ownerHash(USER) },
        annotations: { [ANNOTATION_WALLET_ADDRESS]: '0xdeadbeef' },
      },
      spec: { availability: 'standard', databaseType: 'light' },
    });
    const view = await service.get(USER, 'x');
    expect(view.walletAddress).toBe('0xdeadbeef');
  });
});
