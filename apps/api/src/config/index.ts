import dotenv from 'dotenv';
import { z } from 'zod';

// Load environment variables from .env file
dotenv.config();

const envSchema = z.object({
  PORT: z.coerce.number().default(4000),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  MONGO_URI: z.string().url(),
  REDIS_URI: z.string().url(),
  REDIS_PASSWORD: z.string().optional(),
  JWT_PRIVATE_KEY: z.string().min(1, 'JWT_PRIVATE_KEY is required'),
  JWT_PUBLIC_KEY: z.string().min(1, 'JWT_PUBLIC_KEY is required'),
  MASTER_ENCRYPTION_KEY: z.string().min(32, 'MASTER_ENCRYPTION_KEY must be at least 32 characters'),
  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.coerce.number().optional(),
  SMTP_USER: z.string().optional(),
  SMTP_PASS: z.string().optional(),
  SMTP_FROM: z.string().optional(),
});

const isTest = process.env.NODE_ENV === 'test';

// Provide defaults for test environment to make testing easier without fully populated .env
if (isTest) {
  process.env.MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost:27017/seladev_test';
  process.env.REDIS_URI = process.env.REDIS_URI || 'redis://localhost:6379';
  process.env.JWT_PRIVATE_KEY = process.env.JWT_PRIVATE_KEY || 'test-private-key-dummy-value-placeholder';
  process.env.JWT_PUBLIC_KEY = process.env.JWT_PUBLIC_KEY || 'test-public-key-dummy-value-placeholder';
  process.env.MASTER_ENCRYPTION_KEY = process.env.MASTER_ENCRYPTION_KEY || 'dummy_master_encryption_key_32_chars_long';
}

const parsedEnv = envSchema.safeParse(process.env);

if (!parsedEnv.success) {
  console.error('❌ Invalid environment variables:');
  console.error(JSON.stringify(parsedEnv.error.format(), null, 2));
  process.exit(1);
}

export const config = {
  server: {
    port: parsedEnv.data.PORT,
    env: parsedEnv.data.NODE_ENV,
    isProduction: parsedEnv.data.NODE_ENV === 'production',
    isDevelopment: parsedEnv.data.NODE_ENV === 'development',
    isTest: parsedEnv.data.NODE_ENV === 'test',
  },
  database: {
    uri: parsedEnv.data.MONGO_URI,
  },
  redis: {
    uri: parsedEnv.data.REDIS_URI,
    password: parsedEnv.data.REDIS_PASSWORD,
  },
  jwt: {
    privateKey: parsedEnv.data.JWT_PRIVATE_KEY,
    publicKey: parsedEnv.data.JWT_PUBLIC_KEY,
  },
  security: {
    masterEncryptionKey: parsedEnv.data.MASTER_ENCRYPTION_KEY,
  },
  email: {
    smtpHost: parsedEnv.data.SMTP_HOST || null,
    smtpPort: parsedEnv.data.SMTP_PORT || null,
    smtpUser: parsedEnv.data.SMTP_USER || null,
    smtpPass: parsedEnv.data.SMTP_PASS || null,
    smtpFrom: parsedEnv.data.SMTP_FROM || 'no-reply@seladev.dev',
  },
} as const;

export type Config = typeof config;
