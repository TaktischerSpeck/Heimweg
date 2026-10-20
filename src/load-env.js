import { loadEnvFile } from 'node:process';
import { fileURLToPath } from 'node:url';
const path = process.env.HEIMWEG_ENV_FILE || fileURLToPath(new URL('../.env', import.meta.url));
try {
  loadEnvFile(path);
} catch (error) {
  if (error.code !== 'ENOENT' || process.env.HEIMWEG_ENV_FILE) throw error;
}
