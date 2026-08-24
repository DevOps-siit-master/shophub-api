import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { validationSchema } from './config/env.validation';
import { AuthModule } from './auth/auth.module';
import { HealthModule } from './health/health.module';
import { KubernetesModule } from './kubernetes/kubernetes.module';
import { MetricsModule } from './metrics/metrics.module';
import { ShopsModule } from './shops/shops.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      validationSchema,
    }),
    AuthModule,
    HealthModule,
    KubernetesModule,
    MetricsModule,
    ShopsModule,
  ],
})
export class AppModule {}
