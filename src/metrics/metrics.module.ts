import { Module } from '@nestjs/common';
import {
  makeCounterProvider,
  makeHistogramProvider,
  PrometheusModule,
} from '@willsoto/nestjs-prometheus';
import { HttpMetricsMiddleware } from './http-metrics.middleware';

/**
 * Exposes Prometheus metrics on GET /metrics (spec 4.1). Ships prom-client's
 * default process metrics (CPU, memory, event-loop lag, GC) plus the custom
 * HTTP request counter and latency histogram recorded by
 * {@link HttpMetricsMiddleware}. The middleware is exported and wired globally
 * in main.ts via app.use(); the shophub chart's ServiceMonitor points
 * prometheus-stack's Prometheus at this endpoint.
 */
@Module({
  imports: [
    PrometheusModule.register({
      defaultMetrics: { enabled: true },
    }),
  ],
  providers: [
    makeCounterProvider({
      name: 'http_requests_total',
      help: 'Total HTTP requests handled, labelled by method, route and status code.',
      labelNames: ['method', 'route', 'status_code'],
    }),
    makeHistogramProvider({
      name: 'http_request_duration_seconds',
      help: 'HTTP request duration in seconds, labelled by method, route and status code.',
      labelNames: ['method', 'route', 'status_code'],
      buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5],
    }),
    HttpMetricsMiddleware,
  ],
  exports: [HttpMetricsMiddleware],
})
export class MetricsModule {}
