import cookie from '@fastify/cookie';
import cors from '@fastify/cors';
import Fastify, { type FastifyInstance } from 'fastify';
import type { Deps } from './deps.js';
import { HttpError } from './lib/errors.js';
import { registerSecurityHooks } from './plugins/security.js';
import adminAccountRoutes from './routes/admin-accounts.js';
import adminRoutes from './routes/admin.js';
import authRoutes from './routes/auth.js';
import billingRoutes from './routes/billing.js';
import gateRoutes from './routes/gate.js';
import internalRoutes from './routes/internal.js';
import meRoutes from './routes/me.js';
import oauthRoutes from './routes/oauth.js';
import publicRoutes from './routes/public.js';

export async function buildApp(d: Deps, opts: { logger?: boolean } = {}): Promise<FastifyInstance> {
  const app = Fastify({
    logger:
      opts.logger === false
        ? false
        : {
            level: d.cfg.LOG_LEVEL,
            redact: {
              paths: [
                'req.headers.authorization',
                'req.headers.cookie',
                'req.headers["x-csrf-token"]',
                'res.headers["set-cookie"]',
                '*.password',
                '*.newPassword',
                '*.currentPassword',
                '*.token',
                '*.totpCode',
                '*.code',
              ],
              censor: '[REDACTED]',
            },
          },
    trustProxy: false, // client IP comes from X-Real-IP via lib/net.ts (trusted peers only)
    bodyLimit: 1_048_576,
    requestIdHeader: 'x-request-id',
    genReqId: () => crypto.randomUUID(),
    routerOptions: { ignoreTrailingSlash: true },
  });

  await app.register(cookie, { hook: 'onRequest' });
  await app.register(cors, {
    origin: (origin, cb) => {
      if (!origin) return cb(null, false);
      cb(null, d.cfg.allowedOriginSet.has(origin));
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
    allowedHeaders: ['Content-Type', 'X-CSRF-Token', 'Authorization', 'X-Request-Id'],
    exposedHeaders: ['RateLimit-Limit', 'RateLimit-Remaining', 'Retry-After', 'X-Request-Id'],
    maxAge: 600,
  });

  app.addHook('onSend', async (req, reply, payload) => {
    reply.header('X-Request-Id', req.id);
    reply.header('X-Content-Type-Options', 'nosniff');
    return payload;
  });

  registerSecurityHooks(app, d);

  app.setErrorHandler((err, req, reply) => {
    if (err instanceof HttpError) {
      if (err.statusCode === 429) {
        const retry = (err.details as { retryAfterSeconds?: number } | undefined)?.retryAfterSeconds ?? 60;
        reply.header('Retry-After', retry);
      }
      return reply.code(err.statusCode).send({ error: { code: err.code, message: err.message, ...(err.details !== undefined ? { details: err.details } : {}) } });
    }
    const e = err as Error & { statusCode?: number; code?: string };
    if (e.statusCode && e.statusCode >= 400 && e.statusCode < 500) {
      return reply.code(e.statusCode).send({ error: { code: e.code ?? 'BAD_REQUEST', message: e.message } });
    }
    req.log.error({ err }, 'unhandled error');
    return reply.code(500).send({ error: { code: 'INTERNAL', message: 'Something went wrong', requestId: req.id } });
  });

  app.setNotFoundHandler((_req, reply) => reply.code(404).send({ error: { code: 'NOT_FOUND', message: 'Not found' } }));

  await app.register(async (s) => publicRoutes(s, d));
  await app.register(async (s) => authRoutes(s, d));
  await app.register(async (s) => gateRoutes(s, d));
  await app.register(async (s) => oauthRoutes(s, d));
  await app.register(async (s) => meRoutes(s, d));
  await app.register(async (s) => adminRoutes(s, d));
  await app.register(async (s) => adminAccountRoutes(s, d));
  await app.register(async (s) => billingRoutes(s, d));
  await app.register(async (s) => internalRoutes(s, d));

  return app;
}
