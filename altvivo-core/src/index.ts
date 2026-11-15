import { loadConfig } from './config.js';
import { createDeps } from './container.js';
import { scheduleMaintenance } from './jobs/maintenance.js';
import { buildApp } from './server.js';

async function main() {
  const cfg = loadConfig();
  const deps = await createDeps(cfg);
  const app = await buildApp(deps);
  const timer = scheduleMaintenance(deps, app.log);

  let closing = false;
  const shutdown = async (signal: string) => {
    if (closing) return;
    closing = true;
    app.log.info({ signal }, 'shutting down');
    clearInterval(timer);
    const force = setTimeout(() => process.exit(1), 15_000);
    force.unref();
    try {
      await app.close();
      await deps.prisma.$disconnect();
      deps.redis.disconnect();
      process.exit(0);
    } catch (err) {
      app.log.error({ err }, 'error during shutdown');
      process.exit(1);
    }
  };
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));

  await app.listen({ port: cfg.PORT, host: cfg.HOST });
  app.log.info({ kid: deps.tokens.currentKid }, 'altvivo-core ready');
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exit(1);
});
