import '../src/load-env.js';
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
const header = Buffer.from('HWBACK01');
export function encryptBackup(data, key) {
  const iv = randomBytes(12),
    cipher = createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(header);
  const ciphertext = Buffer.concat([cipher.update(data), cipher.final()]);
  return Buffer.concat([header, iv, cipher.getAuthTag(), ciphertext]);
}
export function decryptBackup(data, key) {
  if (data.length < 36 || !data.subarray(0, 8).equals(header))
    throw new Error('Invalid backup format.');
  const cipher = createDecipheriv('aes-256-gcm', key, data.subarray(8, 20));
  cipher.setAAD(header);
  cipher.setAuthTag(data.subarray(20, 36));
  // Authenticate the entire file before emitting any plaintext to a restore process.
  return Buffer.concat([cipher.update(data.subarray(36)), cipher.final()]);
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const operation = process.argv[2];
    if (!['encrypt', 'decrypt'].includes(operation))
      throw new Error('Expected encrypt or decrypt.');
    const hex = process.env.BACKUP_KEY_FILE
      ? readFileSync(process.env.BACKUP_KEY_FILE, 'utf8').trim()
      : process.env.BACKUP_KEY;
    if (!/^[a-f\d]{64}$/i.test(hex || '')) throw new Error('Invalid backup key.');
    const chunks = [];
    let bytes = 0;
    for await (const chunk of process.stdin) {
      bytes += chunk.length;
      if (bytes > 256 * 1024 * 1024) throw new Error('Backup exceeds the supported 256 MiB size.');
      chunks.push(chunk);
    }
    const result = (operation === 'encrypt' ? encryptBackup : decryptBackup)(
      Buffer.concat(chunks),
      Buffer.from(hex, 'hex'),
    );
    process.stdout.write(result);
  } catch {
    console.error('Backup operation failed. Check the input, key and 256 MiB size limit.');
    process.exitCode = 1;
  }
}
