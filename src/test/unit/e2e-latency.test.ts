import { createE2eLatencyMiddleware, resolveE2eLatencyConfig } from '../../server/middleware/e2e-latency';

describe('E2E API latency', () => {
  it('is off unless E2E_HUB_API_DELAY_MS is a positive number', () => {
    expect(resolveE2eLatencyConfig({})).toBeNull();
    expect(resolveE2eLatencyConfig({ E2E_HUB_API_DELAY_MS: '0' })).toBeNull();
    expect(resolveE2eLatencyConfig({ E2E_HUB_API_DELAY_MS: 'abc' })).toBeNull();
    expect(resolveE2eLatencyConfig({ E2E_HUB_API_DELAY_MS: '2600' })?.delayMs).toBe(2600);
  });

  it('delays matching API paths and never the test-reset routes', () => {
    jest.useFakeTimers();
    try {
      const config = resolveE2eLatencyConfig({ E2E_HUB_API_DELAY_MS: '1000', E2E_HUB_API_DELAY_PATHS: '^/api/chatrooms' })!;
      const middleware = createE2eLatencyMiddleware(config);
      const run = (path: string) => {
        const next = jest.fn();
        middleware({ path } as any, {} as any, next);
        return next;
      };
      const rooms = run('/api/chatrooms/abc/members');
      const talks = run('/api/talks/1');
      const reset = run('/api/test/clear-database');
      expect(rooms).not.toHaveBeenCalled();
      expect(talks).toHaveBeenCalled();
      expect(reset).toHaveBeenCalled();
      jest.advanceTimersByTime(1000);
      expect(rooms).toHaveBeenCalled();
    } finally {
      jest.useRealTimers();
    }
  });
});
