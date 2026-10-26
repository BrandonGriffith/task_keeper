import dotenv from 'dotenv';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../');
dotenv.config({ path: process.env.ENV_FILE || resolve(projectRoot, '.env') });

export function assertRuntimeConfig() {
  const missing = ['MONGODB_URI', 'JWT_SECRET'].filter((name) => !process.env[name]);
  if (missing.length) throw new Error(`Missing required environment variables: ${missing.join(', ')}`);
  if (process.env.JWT_SECRET.length < 32) {
    throw new Error('JWT_SECRET must contain at least 32 characters');
  }
}

export function emailConfigured() {
  const port = Number(process.env.EMAIL_SMTP_PORT);
  return Boolean(
    process.env.EMAIL_SMTP_HOST
    && Number.isInteger(port)
    && port > 0
    && port <= 65535
    && process.env.EMAIL_FROM
    && (!process.env.EMAIL_SMTP_USER || process.env.EMAIL_SMTP_PASSWORD),
  );
}

export function pushConfigured() {
  return Boolean(process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY);
}
