import type { PrismaClient, User, UserRole } from '@prisma/client';
import type { FastifyReply } from 'fastify';
import type { Config } from '../config.js';
import { audit, withAudit, type AuditActor } from '../lib/audit.js';
import type { CookieManager } from '../lib/cookies.js';
import { hmacHex, randomToken } from '../lib/crypto.js';
import type { AccessClaims, SessionClaims, TokenService } from '../lib/jwt.js';
import type { Mailer } from '../lib/mailer.js';
import { templates } from '../lib/mailer.js';
import type { RevocationStore } from '../lib/redis.js';
import { buildEntitlements, loadAccess } from './access.js';

export const MFA_REQUIRED_ROLES: ReadonlySet<UserRole> = new Set(['INSTITUTE_ADMIN', 'SUPERADMIN']);

/** Window in which a just-rotated refresh token may be presented again by a
 *  parallel request (two tabs refreshing at once) without tripping reuse
 *  detection. Such a replay gets a new access token but no new refresh token. */
const ROTATION_GRACE_MS = 15_000;

export interface ClientInfo {
  ip: string;
  userAgent: string | null;
}

export type RotateResult =
  | { kind: 'rotated'; claims: AccessClaims; accessToken: string; refreshToken: string }
  | { kind: 'grace'; claims: AccessClaims; accessToken: string }
  | { kind: 'invalid' }
  | { kind: 'reuse'; userId: string };

export class SessionService {
  constructor(
    private readonly cfg: Config,
    private readonly prisma: PrismaClient,
    private readonly tokens: TokenService,
    private readonly cookies: CookieManager,
    private readonly revocations: RevocationStore,
    private readonly mailer: Mailer,
  ) {}

  hashRefresh(token: string): string {
    return hmacHex(this.cfg.REFRESH_TOKEN_PEPPER, `rt:${token}`);
  }

  async buildClaims(userId: string, sid: string, mfaVerified: boolean): Promise<SessionClaims> {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    const [rows, credits] = await Promise.all([
      loadAccess(this.prisma, userId),
      this.prisma.$queryRaw<{ balance: number }[]>`SELECT credit_balance_for_user(${userId}::uuid) AS balance`,
    ]);
    const enrollmentRequired = MFA_REQUIRED_ROLES.has(user.role) && !user.mfaEnabled;
    const { entitlements, tier } = buildEntitlements(rows, {
      role: user.role,
      vipRoles: this.cfg.vipRoles,
      // A SUPERADMIN gets the bypass only on an MFA-verified session.
      vipEligible: !enrollmentRequired && (!MFA_REQUIRED_ROLES.has(user.role) || mfaVerified) && user.disabledAt === null,
    });
    return {
      sub: user.id,
      email: user.email,
      name: user.fullName,
      org_id: user.orgId,
      role: user.role,
      tier,
      entitlements,
      credits_remaining: Number(credits[0]?.balance ?? 0),
      email_verified: user.emailVerifiedAt !== null,
      sid,
      mfa: mfaVerified,
      ...(enrollmentRequired ? { mfa_enrollment_required: true } : {}),
    };
  }

  private setAccess(reply: FastifyReply, token: string): void {
    this.cookies.setAccess(reply, token, this.tokens.accessTtlSeconds);
  }

  /** New login: session (refresh family) + first refresh token + access token. */
  async login(
    reply: FastifyReply,
    user: Pick<User, 'id'>,
    opts: { mfaVerified: boolean; client: ClientInfo; method: string; actor: AuditActor },
  ): Promise<AccessClaims> {
    const refreshToken = randomToken(32);
    const now = Date.now();
    const session = await withAudit(this.prisma, opts.actor, async (tx) => {
      const s = await tx.authSession.create({
        data: {
          userId: user.id,
          mfaVerified: opts.mfaVerified,
          ipAddress: opts.client.ip,
          userAgent: opts.client.userAgent,
          expiresAt: new Date(now + this.cfg.SESSION_ABSOLUTE_TTL_SECONDS * 1000),
        },
      });
      await tx.refreshToken.create({
        data: {
          sessionId: s.id,
          tokenHash: this.hashRefresh(refreshToken),
          expiresAt: new Date(now + this.cfg.REFRESH_TOKEN_TTL_SECONDS * 1000),
        },
      });
      await tx.user.update({
        where: { id: user.id },
        data: { lastLoginAt: new Date(now), failedLoginCount: 0, lockedUntil: null },
      });
      await audit(tx, 'AUTH.LOGIN', user.id, { method: opts.method, session_id: s.id, mfa: opts.mfaVerified });
      return s;
    });
    const { token, claims } = await this.tokens.sign(await this.buildClaims(user.id, session.id, opts.mfaVerified));
    this.setAccess(reply, token);
    this.cookies.setRefresh(reply, refreshToken);
    return claims;
  }

  /** Re-mint the access token for an existing session (e.g. after MFA enrolment or a plan change). */
  async reissueAccess(reply: FastifyReply, userId: string, sid: string): Promise<AccessClaims> {
    const session = await this.prisma.authSession.findUniqueOrThrow({ where: { id: sid } });
    const { token, claims } = await this.tokens.sign(await this.buildClaims(userId, sid, session.mfaVerified));
    this.setAccess(reply, token);
    return claims;
  }

  async rotate(rawRefresh: string | undefined, client: ClientInfo): Promise<RotateResult> {
    if (!rawRefresh || rawRefresh.length > 128) return { kind: 'invalid' };
    const tokenHash = this.hashRefresh(rawRefresh);
    const row = await this.prisma.refreshToken.findUnique({
      where: { tokenHash },
      include: { session: { include: { user: { select: { id: true, disabledAt: true } } } }, child: { select: { id: true, revokedAt: true } } },
    });
    if (!row) return { kind: 'invalid' };
    const { session } = row;
    const now = new Date();
    if (session.revokedAt || session.expiresAt <= now || session.user.disabledAt) return { kind: 'invalid' };
    if (row.revokedAt) return this.handleReuse(session.id, session.userId, client, 'revoked token presented');
    if (row.expiresAt <= now) return { kind: 'invalid' };

    const claimed = await this.prisma.refreshToken.updateMany({ where: { id: row.id, usedAt: null }, data: { usedAt: now } });
    if (claimed.count === 0) {
      const fresh = await this.prisma.refreshToken.findUnique({ where: { id: row.id }, select: { usedAt: true } });
      const usedAt = fresh?.usedAt ?? row.usedAt;
      if (usedAt && now.getTime() - usedAt.getTime() <= ROTATION_GRACE_MS && row.child && !row.child.revokedAt) {
        const { token, claims } = await this.tokens.sign(await this.buildClaims(session.userId, session.id, session.mfaVerified));
        return { kind: 'grace', claims, accessToken: token };
      }
      return this.handleReuse(session.id, session.userId, client, 'rotated token replayed');
    }

    const next = randomToken(32);
    await this.prisma.$transaction([
      this.prisma.refreshToken.create({
        data: {
          sessionId: session.id,
          parentId: row.id,
          tokenHash: this.hashRefresh(next),
          expiresAt: new Date(now.getTime() + this.cfg.REFRESH_TOKEN_TTL_SECONDS * 1000),
        },
      }),
      this.prisma.authSession.update({ where: { id: session.id }, data: { lastUsedAt: now, ipAddress: client.ip } }),
    ]);
    const { token, claims } = await this.tokens.sign(await this.buildClaims(session.userId, session.id, session.mfaVerified));
    return { kind: 'rotated', claims, accessToken: token, refreshToken: next };
  }

  /** Reuse of a spent refresh token => the family is compromised: kill it. */
  private async handleReuse(sid: string, userId: string, client: ClientInfo, reason: string): Promise<RotateResult> {
    await withAudit(this.prisma, { actorId: userId, ip: client.ip, userAgent: client.userAgent }, async (tx) => {
      await tx.authSession.update({ where: { id: sid }, data: { revokedAt: new Date(), revokeReason: 'refresh_reuse' } });
      await tx.refreshToken.updateMany({ where: { sessionId: sid, revokedAt: null }, data: { revokedAt: new Date() } });
      await audit(tx, 'SECURITY.REFRESH_TOKEN_REUSE', sid, { reason, session_id: sid });
    });
    await this.revocations.revokeSession(sid);
    const user = await this.prisma.user.findUnique({ where: { id: userId }, select: { email: true, fullName: true } });
    if (user) {
      await this.mailer
        .send({ to: user.email, ...templates.securityAlert(user.fullName, 'A signed-out session was replayed and has been blocked') })
        .catch(() => undefined);
    }
    return { kind: 'reuse', userId };
  }

  applyRotation(reply: FastifyReply, r: Extract<RotateResult, { kind: 'rotated' | 'grace' }>): void {
    this.setAccess(reply, r.accessToken);
    if (r.kind === 'rotated') this.cookies.setRefresh(reply, r.refreshToken);
  }

  async revokeSession(sid: string, reason: string, actor: AuditActor): Promise<void> {
    await withAudit(this.prisma, actor, async (tx) => {
      const res = await tx.authSession.updateMany({ where: { id: sid, revokedAt: null }, data: { revokedAt: new Date(), revokeReason: reason } });
      await tx.refreshToken.updateMany({ where: { sessionId: sid, revokedAt: null }, data: { revokedAt: new Date() } });
      if (res.count > 0) await audit(tx, 'AUTH.LOGOUT', sid, { reason, session_id: sid });
    });
    await this.revocations.revokeSession(sid);
  }

  /** Logout-all / password change / account disable. `exceptSid` keeps the caller's session. */
  async revokeAll(userId: string, reason: string, actor: AuditActor, exceptSid?: string): Promise<number> {
    const sessions = await this.prisma.authSession.findMany({
      where: { userId, revokedAt: null, ...(exceptSid ? { id: { not: exceptSid } } : {}) },
      select: { id: true },
    });
    const ids = sessions.map((s) => s.id);
    await withAudit(this.prisma, actor, async (tx) => {
      if (ids.length) {
        await tx.authSession.updateMany({ where: { id: { in: ids } }, data: { revokedAt: new Date(), revokeReason: reason } });
        await tx.refreshToken.updateMany({ where: { sessionId: { in: ids }, revokedAt: null }, data: { revokedAt: new Date() } });
      }
      await audit(tx, 'AUTH.LOGOUT_ALL', userId, { reason, sessions_revoked: ids.length, kept_session: exceptSid ?? null });
    });
    await Promise.all(ids.map((id) => this.revocations.revokeSession(id)));
    if (!exceptSid) await this.revocations.revokeUser(userId);
    return ids.length;
  }
}
