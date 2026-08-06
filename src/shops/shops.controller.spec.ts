import { Test, TestingModule } from '@nestjs/testing';
import type { AuthUser } from '../auth/auth.types';
import { CreateShopDto } from './dto/create-shop.dto';
import { ShopsController } from './shops.controller';
import { ShopsService } from './shops.service';

const user: AuthUser = { userId: 'user-1' };

describe('ShopsController', () => {
  let controller: ShopsController;
  let service: jest.Mocked<
    Pick<ShopsService, 'create' | 'list' | 'get' | 'update' | 'remove'>
  >;

  beforeEach(async () => {
    service = {
      create: jest.fn(),
      list: jest.fn(),
      get: jest.fn(),
      update: jest.fn(),
      remove: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [ShopsController],
      providers: [{ provide: ShopsService, useValue: service }],
    }).compile();

    controller = module.get<ShopsController>(ShopsController);
  });

  it('delegates create to the service with the caller id', async () => {
    const dto = { name: 'S' } as CreateShopDto;
    await controller.create(user, dto);
    expect(service.create).toHaveBeenCalledWith('user-1', dto);
  });

  it('lists shops for the caller', async () => {
    await controller.list(user);
    expect(service.list).toHaveBeenCalledWith('user-1');
  });

  it('delegates delete scoped to the caller', async () => {
    await controller.remove(user, 'shop-x');
    expect(service.remove).toHaveBeenCalledWith('user-1', 'shop-x');
  });
});
