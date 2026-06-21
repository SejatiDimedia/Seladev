import { PubSub } from 'graphql-subscriptions';

export const pubsub = new PubSub<any>();

// Event names constants
export const DEPLOYMENT_STATUS_CHANGED = 'DEPLOYMENT_STATUS_CHANGED';
export const DEPLOYMENT_LOG_ADDED = 'DEPLOYMENT_LOG_ADDED';
