import type { FastifyReply } from 'fastify';
import type { Config } from '../config.js';

export const ACCESS_COOKIE = 'altvivo_at';
export const REFRESH_COOKIE = 'altvivo_rt';
export const CSRF_COOKIE = 'altvivo_csrf';
export const OAUTH_STATE_COOKIE = 'altvivo_oauth';

export const REFRESH_COOKIE_PATH = '/v1/auth/refresh';
export const OAUTH_COOKIE_PATH = '/v1/auth/oauth';

/** Cross-subdomain cookie manager for `.altvivo.bio` (spec section 3.1). */
export class CookieManager {
  constructor(private readonly cfg: Config) {}

  /** Empty COOKIE_DOMAIN = host-only cookies (local development on localhost). */
  private get base() {
    return { ...(this.cfg.COOKIE_DOMAIN ? { domain: this.cfg.COOKIE_DOMAIN } : {}), secure: this.cfg.COOKIE_SECURE };
  }

  setAccess(reply: FastifyReply, token: string, maxAge: number): void {
    reply.setCookie(ACCESS_COOKIE, token, { ...this.base, path: '/', httpOnly: true, sameSite: 'lax', maxAge });
  }

  setRefresh(reply: FastifyReply, token: string): void {
    reply.setCookie(REFRESH_COOKIE, token, {
      ...this.base,
      path: REFRESH_COOKIE_PATH,
      httpOnly: true,
      sameSite: 'strict',
      maxAge: this.cfg.REFRESH_TOKEN_TTL_SECONDS,
    });
  }

  /** Readable by JS on every *.altvivo.bio page (double-submit pattern). */
  setCsrf(reply: FastifyReply, token: string): void {
    reply.setCookie(CSRF_COOKIE, token, {
      ...this.base,
      path: '/',
      httpOnly: false,
      sameSite: 'lax',
      maxAge: this.cfg.SESSION_ABSOLUTE_TTL_SECONDS,
    });
  }

  setOAuthState(reply: FastifyReply, value: string): void {
    reply.setCookie(OAUTH_STATE_COOKIE, value, {
      secure: this.cfg.COOKIE_SECURE,
      path: OAUTH_COOKIE_PATH,
      httpOnly: true,
      sameSite: 'lax',
      maxAge: 600,
    });
  }

  clearOAuthState(reply: FastifyReply): void {
    reply.clearCookie(OAUTH_STATE_COOKIE, { secure: this.cfg.COOKIE_SECURE, path: OAUTH_COOKIE_PATH });
  }

  clearSession(reply: FastifyReply): void {
    reply.clearCookie(ACCESS_COOKIE, { ...this.base, path: '/' });
    reply.clearCookie(REFRESH_COOKIE, { ...this.base, path: REFRESH_COOKIE_PATH });
  }
}
