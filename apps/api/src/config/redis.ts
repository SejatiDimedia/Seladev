import { createClient } from 'redis';
import { config } from './index';

export type RedisClientType = ReturnType<typeof createClient>;

let redisClient: RedisClientType | null = null;

export function getRedisClient(): RedisClientType {
  if (!redisClient) {
    throw new Error('Redis client has not been initialized. Call connectRedis() first.');
  }
  return redisClient;
}

export async function connectRedis(): Promise<RedisClientType> {
  const { uri, password } = config.redis;

  const client = createClient({
    url: uri,
    ...(password ? { password } : {}),
  });

  client.on('connect', () => {
    console.log('💚 Redis client connecting...');
  });

  client.on('ready', () => {
    console.log('💚 Redis client ready');
  });

  client.on('error', (err) => {
    console.error('❌ Redis client error:', err);
  });

  client.on('end', () => {
    console.warn('⚠️ Redis client connection closed');
  });

  try {
    await client.connect();
    redisClient = client;
    return client;
  } catch (error) {
    console.error('❌ Failed to connect to Redis on startup:', error);
    throw error;
  }
}

export async function disconnectRedis(): Promise<void> {
  if (!redisClient) return;
  try {
    await redisClient.quit();
    redisClient = null;
    console.log('💚 Redis disconnected successfully');
  } catch (error) {
    console.error('❌ Error disconnecting Redis:', error);
    throw error;
  }
}
