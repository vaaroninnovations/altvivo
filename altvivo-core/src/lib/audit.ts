import { Prisma, type PrismaClient } from '@prisma/client';

export type Tx = Prisma.TransactionClient;

export interface AuditActor {
  actorId: string | null;
  ip: string | null;
  userAgent: string | null;
  appId?: string;
  actorType?: 'USER' | 'SERVICE' | 'SYSTEM';
}

export const systemActor = (appId = 'core'): AuditActor => ({ actorId: null, ip: null, userAgent: 'altvivo-core', appId, actorType: 'SYSTEM' });

/**
 * Runs `fn` in a READ COMMITTED transaction whose audit context identifies the
 * actor. Every audit_logs row written inside - explicit or by DB triggers -
 * inherits actor/ip/user-agent/app. Keep these transactions short: the audit
 * chain head is locked from the first audit write until commit.
 */
export async function withAudit<T>(prisma: PrismaClient, actor: AuditActor, fn: (tx: Tx) => Promise<T>): Promise<T> {
  return prisma.$transaction(
    async (tx) => {
      await tx.$executeRaw`SELECT audit_set_context(
        ${actor.actorId}::uuid,
        ${actor.ip}::inet,
        ${actor.userAgent},
        ${actor.appId ?? 'core'},
        ${actor.actorType ?? (actor.actorId ? 'USER' : 'SYSTEM')}::audit_actor_type)`;
      return fn(tx);
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted, maxWait: 5000, timeout: 15000 },
  );
}

export async function audit(
  tx: Tx,
  eventType: string,
  resourceId: string | null,
  metadata: Record<string, unknown> = {},
): Promise<void> {
  await tx.auditLog.create({
    data: { eventType, resourceId, metadata: metadata as Prisma.InputJsonValue },
    select: { id: true },
  });
}
