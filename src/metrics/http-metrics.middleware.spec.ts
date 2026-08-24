import type { Counter, Histogram } from 'prom-client';
import { HttpMetricsMiddleware } from './http-metrics.middleware';

type FinishCb = () => void;

describe('HttpMetricsMiddleware', () => {
  let inc: jest.Mock;
  let stopTimer: jest.Mock;
  let startTimer: jest.Mock;
  let middleware: HttpMetricsMiddleware;

  beforeEach(() => {
    inc = jest.fn();
    stopTimer = jest.fn();
    startTimer = jest.fn(() => stopTimer);
    middleware = new HttpMetricsMiddleware(
      { inc } as unknown as Counter<string>,
      { startTimer } as unknown as Histogram<string>,
    );
  });

  /** Builds a response stub that lets the test fire the 'finish' event. */
  const responder = (statusCode: number) => {
    let finish: FinishCb = () => {};
    const res = {
      statusCode,
      once: (_e: string, cb: FinishCb) => {
        finish = cb;
      },
    };
    return { res, finish: () => finish() };
  };

  it('records the matched route pattern, method and status on finish', () => {
    const next = jest.fn();
    const { res, finish } = responder(200);
    const req = { method: 'GET', baseUrl: '/shops', route: { path: '/:name' } };

    middleware.use(req, res, next);
    expect(next).toHaveBeenCalledTimes(1);
    inc.mockClear(); // nothing recorded until the response finishes
    expect(inc).not.toHaveBeenCalled();

    finish();
    const labels = { method: 'GET', route: '/shops/:name', status_code: '200' };
    expect(inc).toHaveBeenCalledWith(labels);
    expect(stopTimer).toHaveBeenCalledWith(labels);
  });

  it('counts guard-rejected requests (401) under their matched route', () => {
    const { res, finish } = responder(401);
    // A guard rejects the request, but the route was already matched by the
    // router, so req.route is populated and the label stays bounded.
    const req = { method: 'GET', baseUrl: '/shops', route: { path: '/:name' } };

    middleware.use(req, res, jest.fn());
    finish();
    expect(inc).toHaveBeenCalledWith({
      method: 'GET',
      route: '/shops/:name',
      status_code: '401',
    });
  });

  it('collapses distinct unmatched 404 URLs to one bounded label', () => {
    // The whole point of the fix: two different missing URLs must produce the
    // same label, otherwise a flood of random 404s explodes cardinality.
    for (const path of ['/does/not/exist', '/also/missing/1234']) {
      const { res, finish } = responder(404);
      middleware.use({ method: 'GET', path }, res, jest.fn());
      finish();
    }
    expect(inc).toHaveBeenCalledTimes(2);
    expect(inc).toHaveBeenNthCalledWith(1, {
      method: 'GET',
      route: 'unmatched',
      status_code: '404',
    });
    expect(inc).toHaveBeenNthCalledWith(2, {
      method: 'GET',
      route: 'unmatched',
      status_code: '404',
    });
  });

  it('uses the bounded label when neither route nor path is present', () => {
    const { res, finish } = responder(500);
    middleware.use({ method: 'POST' }, res, jest.fn());
    finish();
    expect(inc).toHaveBeenCalledWith({
      method: 'POST',
      route: 'unmatched',
      status_code: '500',
    });
  });
});
