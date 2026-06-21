import type { SecretsUser } from '../secrets/secrets.service';
import type DataLoader from 'dataloader';

export interface GraphQLContext {
  user?: SecretsUser & {
    apiKeyId?: string | null;
    apiKeyScopes?: string[] | null;
    jti?: string | null;
  };
  loaders: {
    projectLoader: DataLoader<string, any>;
    environmentLoader: DataLoader<string, any>;
    userLoader: DataLoader<string, any>;
  };
  clientContext: {
    ipAddress: string | null;
    userAgent: string | null;
  };
}
