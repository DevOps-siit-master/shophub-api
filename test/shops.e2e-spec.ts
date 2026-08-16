import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';

// AppModule's ConfigModule validates env on boot, so the JWT secret must be set
// before it is imported/compiled.
process.env.JWT_ACCESS_SECRET = 'e2e-secret';

import { AppModule } from './../src/app.module';
import { JwtAuthGuard } from './../src/auth/jwt-auth.guard';
import {
  CustomResource,
  KubernetesService,
} from './../src/kubernetes/kubernetes.service';
import { ShopView } from './../src/shops/dto/shop-view.dto';

const E2E_USER = 'e2e-user-id';

/** Mimics the client's ApiException shape (an Error carrying a numeric code). */
function apiError(code: number): Error & { code: number } {
  return Object.assign(new Error(`api error ${code}`), { code });
}

/**
 * In-memory stand-in for a Kubernetes cluster. Stores custom resources per
 * plural and supports the single `key=value` label selector the shops layer
 * uses, so the full HTTP → service → "cluster" path is exercised without a real
 * API server.
 */
class FakeCluster {
  private store = new Map<string, Map<string, CustomResource>>();

  private bucket(plural: string): Map<string, CustomResource> {
    if (!this.store.has(plural)) this.store.set(plural, new Map());
    return this.store.get(plural)!;
  }

  create(_g: string, _v: string, plural: string, body: CustomResource) {
    const name = body.metadata!.name!;
    const bucket = this.bucket(plural);
    if (bucket.has(name)) {
      return Promise.reject(apiError(409));
    }
    body.metadata!.creationTimestamp = new Date().toISOString();
    bucket.set(name, JSON.parse(JSON.stringify(body)) as CustomResource);
    return Promise.resolve(body);
  }

  list(_g: string, _v: string, plural: string, labelSelector?: string) {
    let items = [...this.bucket(plural).values()];
    if (labelSelector) {
      const [key, value] = labelSelector.split('=');
      items = items.filter((i) => i.metadata?.labels?.[key] === value);
    }
    return Promise.resolve(items);
  }

  get(_g: string, _v: string, plural: string, name: string) {
    const found = this.bucket(plural).get(name);
    return found ? Promise.resolve(found) : Promise.reject(apiError(404));
  }

  replace(
    _g: string,
    _v: string,
    plural: string,
    name: string,
    body: CustomResource,
  ) {
    this.bucket(plural).set(name, body);
    return Promise.resolve(body);
  }

  delete(_g: string, _v: string, plural: string, name: string) {
    this.bucket(plural).delete(name);
    return Promise.resolve();
  }

  deleteIfExists(_g: string, _v: string, plural: string, name: string) {
    this.bucket(plural).delete(name);
    return Promise.resolve();
  }
}

describe('Shops (e2e)', () => {
  let app: INestApplication<App>;
  let cluster: FakeCluster;

  beforeEach(async () => {
    cluster = new FakeCluster();

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(KubernetesService)
      .useValue(cluster)
      .overrideGuard(JwtAuthGuard)
      .useValue({
        canActivate: (ctx: {
          switchToHttp: () => { getRequest: () => { user?: unknown } };
        }) => {
          ctx.switchToHttp().getRequest().user = { userId: E2E_USER };
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

  afterEach(async () => {
    await app.close();
  });

  const validShop = {
    name: 'Healthy Food',
    availability: 'high',
    databaseType: 'standard',
    walletAddress: '0xabc123',
    discordChannelName: 'orders',
    discordServerId: '999',
  };

  it('creates a single Shop CR (operator owns the child resources)', async () => {
    const res = await request(app.getHttpServer())
      .post('/shops')
      .send(validShop)
      .expect(201);
    const shop = res.body as ShopView;

    expect(shop.displayName).toBe('Healthy Food');
    expect(shop.replicas).toBe(3);
    expect(shop.walletAddress).toBe('0xabc123');

    // Only the Shop is created here; the shop-operator materialises the owned
    // Wallet/DiscordChannel in-cluster, which this in-memory fake does not run.
    const shops = await cluster.list('', '', 'shops');
    expect(shops).toHaveLength(1);
    const shopCr = shops[0];
    expect(shopCr.spec?.wallet).toEqual({ address: '0xabc123' });
    expect(shopCr.spec?.discordChannel).toEqual({
      channelName: 'orders',
      serverID: '999',
    });
  });

  it('rejects an invalid availability value', () => {
    return request(app.getHttpServer())
      .post('/shops')
      .send({ ...validShop, availability: 'ultra' })
      .expect(400);
  });

  it('lists, fetches, updates and deletes a shop', async () => {
    const created = await request(app.getHttpServer())
      .post('/shops')
      .send(validShop)
      .expect(201);
    const name = (created.body as ShopView).name;

    await request(app.getHttpServer())
      .get('/shops')
      .expect(200)
      .expect((r) => {
        expect(r.body as ShopView[]).toHaveLength(1);
      });

    await request(app.getHttpServer())
      .patch(`/shops/${name}`)
      .send({ availability: 'standard' })
      .expect(200)
      .expect((r) =>
        expect((r.body as ShopView).availability).toBe('standard'),
      );

    await request(app.getHttpServer()).delete(`/shops/${name}`).expect(204);
    await request(app.getHttpServer())
      .get('/shops')
      .expect(200)
      .expect((r) => {
        expect(r.body as ShopView[]).toHaveLength(0);
      });
  });
});
