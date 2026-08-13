import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiNoContentResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import type { AuthUser } from '../auth/auth.types';
import { CurrentUser } from '../auth/current-user.decorator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CreateShopDto } from './dto/create-shop.dto';
import { ShopView } from './dto/shop-view.dto';
import { UpdateShopDto } from './dto/update-shop.dto';
import { ShopsService } from './shops.service';

@ApiTags('shops')
@ApiBearerAuth()
@ApiUnauthorizedResponse({ description: 'Missing or invalid access token' })
@UseGuards(JwtAuthGuard)
@Controller('shops')
export class ShopsController {
  constructor(private readonly shops: ShopsService) {}

  @Post()
  @ApiCreatedResponse({
    type: ShopView,
    description: 'Shop deployment created',
  })
  create(
    @CurrentUser() user: AuthUser,
    @Body() dto: CreateShopDto,
  ): Promise<ShopView> {
    return this.shops.create(user.userId, dto);
  }

  @Get()
  @ApiOkResponse({ type: [ShopView], description: "The caller's shops" })
  list(@CurrentUser() user: AuthUser): Promise<ShopView[]> {
    return this.shops.list(user.userId);
  }

  @Get(':name')
  @ApiOkResponse({ type: ShopView })
  @ApiNotFoundResponse({ description: 'Shop not found' })
  get(
    @CurrentUser() user: AuthUser,
    @Param('name') name: string,
  ): Promise<ShopView> {
    return this.shops.get(user.userId, name);
  }

  @Patch(':name')
  @ApiOkResponse({ type: ShopView, description: 'Shop reconfigured' })
  @ApiNotFoundResponse({ description: 'Shop not found' })
  update(
    @CurrentUser() user: AuthUser,
    @Param('name') name: string,
    @Body() dto: UpdateShopDto,
  ): Promise<ShopView> {
    return this.shops.update(user.userId, name, dto);
  }

  @Delete(':name')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiNoContentResponse({ description: 'Shop and its resources deleted' })
  @ApiNotFoundResponse({ description: 'Shop not found' })
  remove(
    @CurrentUser() user: AuthUser,
    @Param('name') name: string,
  ): Promise<void> {
    return this.shops.remove(user.userId, name);
  }
}
