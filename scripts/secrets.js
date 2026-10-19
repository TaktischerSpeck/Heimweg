import { mkdir, writeFile } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
await mkdir('secrets', { recursive: true, mode: 0o700 });
for (const file of ['encryption_key', 'setup_token', 'db_password', 'backup_key']) {
  try {
    await writeFile(`secrets/${file}`, randomBytes(32).toString('hex') + '\n', {
      flag: 'wx',
      mode: 0o600,
    });
    console.log(`Created secrets/${file}`);
  } catch (error) {
    if (error.code !== 'EEXIST') throw error;
    console.log(`Kept existing secrets/${file}`);
  }
}
