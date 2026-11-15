import type { FastifyInstance, FastifyRequest } from 'fastify';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { Deps } from '../deps.js';
import { audit, withAudit, type AuditActor } from '../lib/audit.js';
import { HttpError, badRequest, forbidden, notFound } from '../lib/errors.js';
import { EXT_BY_TYPE, MAX_BYTES_BY_TYPE, MIME_BY_TYPE, SNIFF_BYTES, matchesDeclaredType, sanitizeFileName, type VaultFileType } from '../lib/magic.js';
import { userAgent } from '../lib/net.js';
import { parse, requireService } from '../plugins/security.js';
import { buildEntitlements, isEntitled, loadAccess } from '../services/access.js';
import { postLedger } from '../services/credits.js';
import { MFA_REQUIRED_ROLES } from '../services/sessions.js';
import { listApps } from '../services/registry.js';

/**
 * Spoke -> core API. Reachable only on the Docker network (Caddy returns 404
 * for /v1/internal/* on every public host) and authenticated with the spoke's
 * service token. The spoke vouches for the end user it acts for (userId).
 */

const uuid = z.string().uuid();
const referenceId = z.string().min(1).max(255).regex(/^[A-Za-z0-9:._-]+$/);
const actionType = z.string().regex(/^[A-Z][A-Z0-9_]{1,63}$/);

const DebitBody = z.object({ userId: uuid, amount: z.number().int().min(1).max(1_000_000), actionType, referenceId });
const RefundBody = z.object({ userId: uuid, amount: z.number().int().min(1).max(1_000_000), referenceId });
const UploadBody = z.object({
  userId: uuid,
  fileName: z.string().min(1).max(255),
  fileType: z.enum(['CSV', 'JSON', 'MP4', 'PDF']),
  sizeBytes: z.number().int().min(1),
  sha256: z.string().regex(/^[0-9a-f]{64}$/),
});
const CompleteBody = z.object({ objectKey: z.string().min(10).max(1024) });
const AuditBody = z.object({
  userId: uuid.nullable(),
  eventType: z.string().regex(/^[A-Z][A-Z0-9_]*(\.[A-Z][A-Z0-9_]*)*$/).max(64),
  resourceId: z.string().max(255).nullable().default(null),
  metadata: z.record(z.unknown()).default({}),
  actorIp: z.string().ip().nullable().default(null),
  userAgent: z.string().max(512).nullable().default(null),
});

interface PendingUpload {
  userId: string;
  appId: string;
  fileName: string;
  fileType: VaultFileType;
  sizeBytes: number;
  sha256: string;
}

const serviceActor = (req: FastifyRequest, userId: string | null, ip: string | null = null, ua: string | null = null): AuditActor => ({
  actorId: userId,
  ip: ip ?? req.clientIp,
  userAgent: ua ?? userAgent(req),
  appId: req.service!.appId,
  actorType: 'SERVICE',
});

export default async function internalRoutes(app: FastifyInstance, d: Deps) {
  const svc = requireService(d);
  const opts = { config: { csrf: false, rateLimit: 'internal' as const }, preHandler: svc };

  async function activeUser(userId: string) {
    const user = await d.prisma.user.findUnique({ where: { id: userId }, select: { id: true, orgId: true, disabledAt: true } });
    if (!user || user.disabledAt) throw notFound('UNKNOWN_USER', 'Unknown or disabled user');
    return user;
  }

  /** Fresh (not token) entitlements, VIP bypass included. */
  async function liveEntitlements(userId: string) {
    const user = await d.prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { role: true, mfaEnabled: true, disabledAt: true } });
    const rows = await loadAccess(d.prisma, userId);
    return buildEntitlements(rows, {
      role: user.role,
      vipRoles: d.cfg.vipRoles,
      vipEligible: user.disabledAt === null && (!MFA_REQUIRED_ROLES.has(user.role) || user.mfaEnabled),
    });
  }

  async function assertEntitled(userId: string, appId: string) {
    const { entitlements } = await liveEntitlements(userId);
    if (!isEntitled(entitlements[appId])) throw forbidden('NOT_ENTITLED', `User has no paid access to ${appId}`);
    return entitlements[appId]!;
  }

  app.get('/v1/internal/registry', opts, async () => ({ apps: await listApps(d.prisma, d.redis) }));

  /** Fresh claims for a user (spokes may call this instead of trusting a 15-min-old JWT). */
  app.get('/v1/internal/users/:id/entitlements', opts, async (req) => {
    const { id } = parse(z.object({ id: uuid }), req.params);
    await activeUser(id);
    const [{ entitlements, tier }, credits] = await Promise.all([
      liveEntitlements(id),
      d.prisma.$queryRaw<{ balance: number }[]>`SELECT credit_balance_for_user(${id}::uuid) AS balance`,
    ]);
    return {
      userId: id,
      tier,
      entitlements,
      creditsRemaining: Number(credits[0]?.balance ?? 0),
    };
  });

  // ------------------------------------------------------------- credits ---
  app.post('/v1/internal/credits/debit', opts, async (req) => {
    const body = parse(DebitBody, req.body);
    const appId = req.service!.appId;
    const user = await activeUser(body.userId);
    await assertEntitled(user.id, appId);
    const appRow = await d.prisma.appRegistry.findUniqueOrThrow({ where: { appId }, select: { requiresCredits: true } });
    if (!appRow.requiresCredits) throw badRequest('CREDITS_NOT_REQUIRED', `${appId} is not configured to consume credits`);
    const entry = await withAudit(d.prisma, serviceActor(req, user.id), (tx) =>
      postLedger(tx, {
        userId: user.id,
        orgId: user.orgId,
        appId,
        actionType: body.actionType,
        delta: -body.amount,
        referenceId: `${appId}:${body.referenceId}`,
      }),
    );
    return { ledgerEntryId: entry.id, balance: entry.balanceAfter };
  });

  /** Refund a failed job: positive entry referencing the original debit. */
  app.post('/v1/internal/credits/refund', opts, async (req) => {
    const body = parse(RefundBody, req.body);
    const appId = req.service!.appId;
    const user = await activeUser(body.userId);
    const original = `${appId}:${body.referenceId}`;
    const entry = await withAudit(d.prisma, serviceActor(req, user.id), async (tx) => {
      const debits = await tx.creditLedger.findMany({
        where: { referenceId: original, appId, delta: { lt: 0 }, OR: [{ userId: user.id }, ...(user.orgId ? [{ orgId: user.orgId }] : [])] },
        select: { delta: true },
      });
      const debited = debits.reduce((s, r) => s - r.delta, 0);
      if (debited === 0) throw notFound('UNKNOWN_DEBIT', 'No debit found for that reference');
      if (body.amount > debited) throw badRequest('REFUND_EXCEEDS_DEBIT', `Refund exceeds the original debit of ${debited}`);
      return postLedger(tx, { userId: user.id, orgId: user.orgId, appId, actionType: 'REFUND', delta: body.amount, referenceId: original });
    });
    return { ledgerEntryId: entry.id, balance: entry.balanceAfter };
  });

  // --------------------------------------------------- audit passthrough ---
  /** Spokes record GLP-relevant actions (experiment run, export, sign-off) in the central chain. */
  app.post('/v1/internal/audit', opts, async (req, reply) => {
    const body = parse(AuditBody, req.body);
    if (body.eventType.startsWith('DB.') || body.eventType.startsWith('ADMIN.') || body.eventType.startsWith('AUTH.')) {
      throw forbidden('RESERVED_EVENT_TYPE', 'This event namespace is reserved for core');
    }
    if (body.userId) await activeUser(body.userId);
    await withAudit(d.prisma, serviceActor(req, body.userId, body.actorIp, body.userAgent), (tx) =>
      audit(tx, body.eventType, body.resourceId, body.metadata),
    );
    return reply.code(201).send({ status: 'recorded' });
  });

  // --------------------------------------------------------------- vault ---
  app.post('/v1/internal/vault/upload-url', opts, async (req) => {
    const body = parse(UploadBody, req.body);
    const appId = req.service!.appId;
    await activeUser(body.userId);
    await assertEntitled(body.userId, appId);
    const fileName = sanitizeFileName(body.fileName);
    const lower = fileName.toLowerCase();
    if (!EXT_BY_TYPE[body.fileType].some((ext) => lower.endsWith(ext))) {
      throw badRequest('EXTENSION_MISMATCH', `File name must end with ${EXT_BY_TYPE[body.fileType].join(' or ')}`);
    }
    if (body.sizeBytes > MAX_BYTES_BY_TYPE[body.fileType]) throw badRequest('FILE_TOO_LARGE', 'File exceeds the size limit for its type');

    const objectKey = `vault/${body.userId}/${appId}/${randomUUID()}/${fileName.replace(/[^A-Za-z0-9._-]/g, '_')}`;
    const ttl = d.cfg.R2_PRESIGN_TTL_SECONDS;
    const signed = await d.storage.presignPut({
      bucket: d.cfg.R2_BUCKET_VAULT,
      key: objectKey,
      contentType: MIME_BY_TYPE[body.fileType],
      contentLength: body.sizeBytes,
      sha256Hex: body.sha256,
      expiresIn: ttl,
    });
    const pending: PendingUpload = { userId: body.userId, appId, fileName, fileType: body.fileType, sizeBytes: body.sizeBytes, sha256: body.sha256 };
    await d.redis.set(`vault:pending:${objectKey}`, JSON.stringify(pending), 'EX', ttl + 3600);
    return { objectKey, uploadUrl: signed.url, method: 'PUT', headers: signed.headers, expiresAt: new Date(Date.now() + ttl * 1000).toISOString() };
  });

  /** After the browser's PUT: verify size + magic bytes, then register the file. */
  app.post('/v1/internal/vault/complete', opts, async (req, reply) => {
    const { objectKey } = parse(CompleteBody, req.body);
    const raw = await d.redis.get(`vault:pending:${objectKey}`);
    if (!raw) throw notFound('UPLOAD_NOT_FOUND', 'Unknown or expired upload');
    const p = JSON.parse(raw) as PendingUpload;
    if (p.appId !== req.service!.appId) throw forbidden();

    const head = await d.storage.head(d.cfg.R2_BUCKET_VAULT, objectKey);
    if (!head) throw new HttpError(409, 'UPLOAD_MISSING', 'The object has not been uploaded yet');
    const reject = async (code: string, message: string) => {
      await d.storage.remove(d.cfg.R2_BUCKET_VAULT, objectKey).catch(() => undefined);
      await d.redis.del(`vault:pending:${objectKey}`);
      await withAudit(d.prisma, serviceActor(req, p.userId), (tx) =>
        audit(tx, 'VAULT.UPLOAD_REJECTED', objectKey, { reason: code, file_type: p.fileType }),
      );
      throw new HttpError(422, code, message);
    };
    if (head.size !== p.sizeBytes) return reject('SIZE_MISMATCH', 'Uploaded size does not match the declared size');
    const sniff = await d.storage.readHead(d.cfg.R2_BUCKET_VAULT, objectKey, SNIFF_BYTES);
    if (!matchesDeclaredType(p.fileType, sniff)) return reject('CONTENT_TYPE_MISMATCH', `File content is not a valid ${p.fileType}`);

    const user = await activeUser(p.userId);
    const file = await withAudit(d.prisma, serviceActor(req, p.userId), (tx) =>
      tx.workspaceFile.create({
        data: {
          ownerId: p.userId,
          orgId: user.orgId,
          sourceApp: p.appId,
          fileName: p.fileName,
          fileType: p.fileType,
          r2ObjectKey: objectKey,
          sizeBytes: BigInt(p.sizeBytes),
          sha256Hash: p.sha256,
        },
      }),
    );
    await d.redis.del(`vault:pending:${objectKey}`);
    return reply.code(201).send({ file: { id: file.id, fileName: file.fileName, fileType: file.fileType, sizeBytes: p.sizeBytes, sha256: p.sha256, sourceApp: p.appId } });
  });

  /** Cross-app vault: any spoke may read files the acting user owns. */
  app.get<{ Params: { id: string }; Querystring: { userId?: string } }>('/v1/internal/vault/files/:id/download-url', opts, async (req) => {
    const { id } = parse(z.object({ id: uuid }), req.params);
    const { userId } = parse(z.object({ userId: uuid }), req.query);
    const file = await d.prisma.workspaceFile.findUnique({ where: { id } });
    if (!file || file.deletedAt || file.ownerId !== userId) throw notFound();
    await assertEntitled(userId, req.service!.appId);
    const url = await d.storage.presignGet(d.cfg.R2_BUCKET_VAULT, file.r2ObjectKey, d.cfg.R2_PRESIGN_TTL_SECONDS, file.fileName);
    await withAudit(d.prisma, serviceActor(req, userId), (tx) => audit(tx, 'VAULT.DOWNLOAD', file.id, { source_app: file.sourceApp }));
    return { url, fileName: file.fileName, fileType: file.fileType, sha256: file.sha256Hash, expiresInSeconds: d.cfg.R2_PRESIGN_TTL_SECONDS };
  });
}
