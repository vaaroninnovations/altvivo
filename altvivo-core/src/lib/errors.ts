export class HttpError extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly code: string,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = 'HttpError';
  }
}

export const badRequest = (code: string, message: string, details?: unknown) => new HttpError(400, code, message, details);
export const unauthorized = (code = 'UNAUTHENTICATED', message = 'Authentication required') => new HttpError(401, code, message);
export const forbidden = (code = 'FORBIDDEN', message = 'You do not have access to this resource') =>
  new HttpError(403, code, message);
export const notFound = (code = 'NOT_FOUND', message = 'Not found') => new HttpError(404, code, message);
export const conflict = (code: string, message: string) => new HttpError(409, code, message);
export const tooMany = (retryAfterSeconds: number) =>
  new HttpError(429, 'RATE_LIMITED', 'Too many requests, slow down', { retryAfterSeconds });
export const unavailable = (code: string, message: string) => new HttpError(503, code, message);

const SQLSTATE_IN_MESSAGE = /PostgresError\s*\{\s*code:\s*\\*"([0-9A-Z]{5})\\*"/;

/** Postgres SQLSTATE carried by a Prisma error, if any. */
export function pgCode(err: unknown): string | undefined {
  const e = err as { code?: string; meta?: { code?: string } };
  if (e?.code === 'P2010' && typeof e.meta?.code === 'string') return e.meta.code;
  if (e?.code === 'P2002') return '23505';
  if (e?.code === 'P2003') return '23503';
  // Exceptions raised by triggers during model queries surface as connector
  // errors: ...QueryError(PostgresError { code: "23514", message: ... })
  const msg = (err as Error | undefined)?.message ?? '';
  return SQLSTATE_IN_MESSAGE.exec(msg)?.[1];
}
