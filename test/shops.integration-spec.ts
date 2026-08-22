import { writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { K3sContainer, StartedK3sContainer } from '@testcontainers/k3s';
import {
  ApiextensionsV1Api,
  CoreV1Api,
  CustomObjectsApi,
  KubeConfig,
} from '@kubernetes/client-node';
import request from 'supertest';
import { App } from 'supertest/types';

// AppModule's ConfigModule validates env on boot, so secrets must be set before
// it (and the KubernetesService) are wired up.
process.env.JWT_ACCESS_SECRET = 'integration-secret';

import { AppModule } from './../src/app.module';
import { JwtAuthGuard } from './../src/auth/jwt-auth.guard';
import { ShopView } from './../src/shops/dto/shop-view.dto';
import { SHOP_CRD } from './fixtures/shop-crd';

const INTEGRATION_USER = 'integration-user-id';
const NAMESPACE = 'shophub-shops';
const CRD_GROUP = 'shophub.devops-siit.io';
const CRD_VERSION = 'v1';

/** Polls `fn` until it resolves without throwing, or the retry budget runs out. */
async function waitFor<T>(
  fn: () => Promise<T>,
  { retries, delayMs }: { retries: number; delayMs: number },
): Promise<T> {
  let lastErr: unknown;
  for (let i = 0; i < retries; i++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      await new Promise((r) => setTimeout(r, delayMs));
    }
  }
  throw lastErr;
}

/**
 * Full integration path for the shops API: the real Nest app + real
 * KubernetesService talking to a live k3s API server (Testcontainers). Proves
 * the HTTP → service → cluster round-trip that the mocked e2e suite cannot.
 */
describe('Shops (integration, real k3s)', () => {
  let cluster: StartedK3sContainer;
  let app: INestApplication<App>;
  let customApi: CustomObjectsApi;

  beforeAll(async () => {
    // 1. Boot a throwaway single-node Kubernetes cluster.
    cluster = await new K3sContainer('rancher/k3s:v1.31.5-k3s1').start();

    // 2. Point the client (and thus KubernetesService) at it via KUBECONFIG.
    const kubeConfigPath = join(tmpdir(), `kubeconfig-${Date.now()}.yaml`);
    writeFileSync(kubeConfigPath, cluster.getKubeConfig());
    process.env.KUBECONFIG = kubeConfigPath;
    process.env.SHOP_NAMESPACE = NAMESPACE;

    const kc = new KubeConfig();
    kc.loadFromDefault();
    const core = kc.makeApiClient(CoreV1Api);
    const apiExt = kc.makeApiClient(ApiextensionsV1Api);
    customApi = kc.makeApiClient(CustomObjectsApi);

    // 3. Wait for the API server to accept requests.
    await waitFor(() => core.listNamespace(), { retries: 30, delayMs: 2000 });

    // 4. Install the Shop CRD and the target namespace.
    await apiExt.createCustomResourceDefinition({ body: SHOP_CRD });
    await core.createNamespace({ body: { metadata: { name: NAMESPACE } } });

    // 5. Wait until the CRD is established (listing shops no longer 404s).
    await waitFor(
      () =>
        customApi.listNamespacedCustomObject({
          group: CRD_GROUP,
          version: CRD_VERSION,
          namespace: NAMESPACE,
          plural: 'shops',
        }),
      { retries: 30, delayMs: 1000 },
    );

    // 6. Boot the real app, stubbing only auth to inject a fixed user.
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({
        canActivate: (ctx: {
          switchToHttp: () => { getRequest: () => { user?: unknown } };
        }) => {
          ctx.switchToHttp().getRequest().user = { userId: INTEGRATION_USER };
          return true;
        },
      })
      .compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );
    await app.init();
  });

  afterAll(async () => {
    await app?.close();
    await cluster?.stop();
  });

  const validShop = {
    name: 'Healthy Food',
    availability: 'high',
    databaseType: 'standard',
    walletAddress: '0xabc123',
    discordChannelName: 'orders',
    discordServerId: '999',
  };

  it('creates a Shop CR in the real cluster with inline wallet + discord config', async () => {
    const res = await request(app.getHttpServer())
      .post('/shops')
      .send(validShop)
      .expect(201);
    const shop = res.body as ShopView;

    expect(shop.displayName).toBe('Healthy Food');
    expect(shop.replicas).toBe(3); // high → 3
    expect(shop.walletAddress).toBe('0xabc123');

    // The Shop actually exists in the cluster with the inline config.
    const cr = (await customApi.getNamespacedCustomObject({
      group: CRD_GROUP,
      version: CRD_VERSION,
      namespace: NAMESPACE,
      plural: 'shops',
      name: shop.name,
    })) as { spec?: Record<string, unknown> };
    expect(cr.spec?.wallet).toEqual({ address: '0xabc123' });
    expect(cr.spec?.discordChannel).toEqual({
      channelName: 'orders',
      serverID: '999',
    });
  });

  it('rejects an invalid availability value (400, no CR created)', async () => {
    await request(app.getHttpServer())
      .post('/shops')
      .send({ ...validShop, name: 'Bad Shop', availability: 'ultra' })
      .expect(400);
  });

  it('lists, updates and deletes the shop end to end', async () => {
    const list = await request(app.getHttpServer()).get('/shops').expect(200);
    const shops = list.body as ShopView[];
    expect(shops).toHaveLength(1);
    const name = shops[0].name;

    await request(app.getHttpServer())
      .patch(`/shops/${name}`)
      .send({ availability: 'standard', walletAddress: '0xnew' })
      .expect(200)
      .expect((r) => {
        const v = r.body as ShopView;
        expect(v.availability).toBe('standard');
        expect(v.walletAddress).toBe('0xnew');
      });

    // The update reached the cluster.
    const cr = (await customApi.getNamespacedCustomObject({
      group: CRD_GROUP,
      version: CRD_VERSION,
      namespace: NAMESPACE,
      plural: 'shops',
      name,
    })) as { spec?: { wallet?: { address?: string } } };
    expect(cr.spec?.wallet?.address).toBe('0xnew');

    await request(app.getHttpServer()).delete(`/shops/${name}`).expect(204);

    await request(app.getHttpServer())
      .get('/shops')
      .expect(200)
      .expect((r) => expect(r.body as ShopView[]).toHaveLength(0));
  });
});
