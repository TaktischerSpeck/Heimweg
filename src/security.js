import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from 'node:crypto';
import argon2 from 'argon2';

export const token = () => randomBytes(32).toString('hex');
export const digest = (value) => createHash('sha256').update(value).digest('hex');
export const csrfFor = (sessionToken, key) =>
  createHmac('sha256', Buffer.from(key, 'hex')).update(sessionToken).digest('hex');
export function equal(a, b) {
  return (
    typeof a === 'string' &&
    typeof b === 'string' &&
    timingSafeEqual(Buffer.from(digest(a)), Buffer.from(digest(b)))
  );
}
export const hashPassword = (password) =>
  argon2.hash(password, { type: argon2.argon2id, memoryCost: 65536, timeCost: 3, parallelism: 1 });
export const verifyPassword = (hash, password) => argon2.verify(hash, password);

export function cipher(hexKey) {
  const key = Buffer.from(hexKey, 'hex');
  return {
    encrypt(value, context) {
      const iv = randomBytes(12);
      const engine = createCipheriv('aes-256-gcm', key, iv);
      engine.setAAD(Buffer.from(context));
      const body = Buffer.concat([engine.update(JSON.stringify(value), 'utf8'), engine.final()]);
      return [
        'v1',
        iv.toString('base64'),
        engine.getAuthTag().toString('base64'),
        body.toString('base64'),
      ].join('.');
    },
    decrypt(value, context) {
      const [version, iv, tag, body] = value.split('.');
      if (version !== 'v1') throw new Error('Unsupported ciphertext version.');
      const engine = createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'base64'));
      engine.setAAD(Buffer.from(context));
      engine.setAuthTag(Buffer.from(tag, 'base64'));
      return JSON.parse(
        Buffer.concat([engine.update(Buffer.from(body, 'base64')), engine.final()]).toString(
          'utf8',
        ),
      );
    },
  };
}
