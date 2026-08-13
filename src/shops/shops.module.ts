import { Module } from '@nestjs/common';
import { KubernetesModule } from '../kubernetes/kubernetes.module';
import { ShopsController } from './shops.controller';
import { ShopsService } from './shops.service';

@Module({
  imports: [KubernetesModule],
  controllers: [ShopsController],
  providers: [ShopsService],
})
export class ShopsModule {}
