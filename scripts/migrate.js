import '../src/load-env.js';
import { getConfig } from '../src/config.js';
import { createPool, migrate } from '../src/db.js';
const pool = createPool(getConfig());
try {
  await migrate(pool);
  console.log('Database migrations completed.');
} catch {
  console.error('Database migrations failed. Check database connectivity and permissions.');
  process.exitCode = 1;
} finally {
  await pool.end();
}
