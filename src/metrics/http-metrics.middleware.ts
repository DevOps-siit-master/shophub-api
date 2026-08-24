import { Injectable, NestMiddleware } from '@nestjs/common';
import { InjectMetric } from '@willsoto/nestjs-prometheus';
import { Counter, Histogram } from 'prom-client';

/** The bits of the Express request/response we read — kept local so the
 *  middleware does not depend on @types/express being present. */
interface MetricsRequest {
  method: string;
  baseUrl?: string;
  route?: { path?: string };
  // The raw request path exists on every request but is deliberately NOT used
  // as a metric label — see routeOf() for why (cardinality).
  path?: string;
}

/** Bounded label used for any request that never matched a route (404s, and
 *  guard rejections with no matched route), so a flood of distinct URLs cannot
 *  create unbounded series. */
const UNMATCHED_ROUTE = 'unmatched';
interface MetricsResponse {
  statusCode: number;
  once(event: 'finish', listener: () => void): void;
}
type NextFn = () => void;

/**
 * Records an HTTP request counter and a latency histogram for every request,
 * labelled by method, route and status code (spec 4.1). Registered globally via
 * app.use() so it runs before guards — unlike an interceptor it therefore also
 * counts guard-rejected (401/403) and unmatched (404) requests. Prometheus
 * (from prometheus-stack) scrapes these off /metrics via the shophub chart's
 * ServiceMonitor.
 */
@Injectable()
export class HttpMetricsMiddleware implements NestMiddleware {
  constructor(
    @InjectMetric('http_requests_total')
    private readonly requests: Counter<string>,
    @InjectMetric('http_request_duration_seconds')
    private readonly duration: Histogram<string>,
  ) {}

  use(req: MetricsRequest, res: MetricsResponse, next: NextFn): void {
    const stopTimer = this.duration.startTimer();

    // 'finish' fires once the response is fully sent, so the status code is
    // final and — for matched routes — req.route is populated by then.
    res.once('finish', () => {
      const labels = {
        method: req.method,
        route: this.routeOf(req),
        status_code: String(res.statusCode),
      };
      this.requests.inc(labels);
      stopTimer(labels);
    });

    next();
  }

  /**
   * Prefers the matched route pattern (e.g. /shops/:name) so path params do not
   * explode cardinality. Requests that never matched a route (404s, and guard
   * rejections with no route) all collapse to a single constant — using the raw
   * path here would let a flood of distinct 404 URLs create unbounded series on
   * the counter and on every histogram bucket. The offending URLs are still
   * visible in the access logs (Loki), which is the right place for high-
   * cardinality detail (spec 4.1).
   */
  private routeOf(req: MetricsRequest): string {
    if (req.route?.path) {
      return `${req.baseUrl ?? ''}${req.route.path}`;
    }
    return UNMATCHED_ROUTE;
  }
}
