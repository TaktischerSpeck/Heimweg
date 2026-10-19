import { getConfig } from './config.js';
import { createPool, migrate } from './db.js';
import { createApp } from './app.js';

try {
  const config = getConfig();
  const pool = createPool(config);
  pool.on('error', () => console.error('Database connection error.'));
  await migrate(pool);
  const server = await createApp(pool, config);
  const cleanup = setInterval(() => {
    pool
      .query('DELETE FROM sessions WHERE expires_at <= now()')
      .catch(() => console.error('Session cleanup failed.'));
    pool
      .query('DELETE FROM rate_limits WHERE resets_at <= now()')
      .catch(() => console.error('Rate-limit cleanup failed.'));
  }, 600000);
  cleanup.unref();
  server.listen(config.port, '0.0.0.0', () =>
    console.log(`Heimweg listening on port ${config.port}.`),
  );
  function shutdown() {
    clearInterval(cleanup);
    server.close(() => {
      pool.end().finally(() => process.exit(0));
    });
    setTimeout(() => process.exit(1), 10000).unref();
  }
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
} catch {
  console.error('Startup failed. Check database connectivity, migrations and deployment secrets.');
  process.exitCode = 1;
}
