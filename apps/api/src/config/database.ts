import mongoose from 'mongoose';
import { config } from './index';

export async function connectDatabase(): Promise<void> {
  const { uri } = config.database;

  mongoose.connection.on('connected', () => {
    console.log('💚 MongoDB connected successfully');
  });

  mongoose.connection.on('error', (err) => {
    console.error('❌ MongoDB connection error:', err);
  });

  mongoose.connection.on('disconnected', () => {
    console.warn('⚠️ MongoDB disconnected');
  });

  try {
    await mongoose.connect(uri);
  } catch (error) {
    console.error('❌ Failed to connect to MongoDB on startup:', error);
    throw error;
  }
}

export async function disconnectDatabase(): Promise<void> {
  try {
    await mongoose.disconnect();
    console.log('💚 MongoDB disconnected successfully');
  } catch (error) {
    console.error('❌ Error disconnecting MongoDB:', error);
    throw error;
  }
}
