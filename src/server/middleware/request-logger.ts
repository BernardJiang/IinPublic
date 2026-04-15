/**
 * HTTP request-logging middleware (INF-05)
 *
 * Attaches a unique `requestId` to every request, logs request start and
 * completion as structured JSON via the root logger, and exposes a per-request
 * child logger on `res.locals.log` for use inside route handlers.
 */
import { Request, Response, NextFunction } from 'express';
import { randomUUID } from 'crypto';
import { logger } from '../logger';

declare global {
  // Augment Express so route handlers can call `res.locals.log.info(...)`.
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Locals {
      log: typeof logger;
      requestId: string;
    }
  }
}

export function requestLogger(req: Request, res: Response, next: NextFunction): void {
  const requestId = (req.headers['x-request-id'] as string) || randomUUID();
  const startTime = Date.now();

  // Expose requestId in response headers so clients/load-balancers can correlate logs.
  res.setHeader('x-request-id', requestId);

  // Bind requestId + route context to a child logger available inside handlers.
  const reqLog = logger.child({ requestId });
  res.locals.log = reqLog;
  res.locals.requestId = requestId;

  // Skip noisy health-check endpoint.
  const isHealthCheck = req.path === '/health';

  if (!isHealthCheck) {
    reqLog.info(
      {
        method: req.method,
        url: req.originalUrl,
        userAgent: req.get('user-agent'),
        remoteIp: req.ip,
      },
      'request start',
    );
  }

  res.on('finish', () => {
    const durationMs = Date.now() - startTime;
    const level = res.statusCode >= 500 ? 'error' : res.statusCode >= 400 ? 'warn' : 'info';
    if (!isHealthCheck || level !== 'info') {
      reqLog[level](
        {
          method: req.method,
          url: req.originalUrl,
          statusCode: res.statusCode,
          durationMs,
        },
        'request complete',
      );
    }
  });

  next();
}
