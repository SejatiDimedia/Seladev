export interface EnvironmentVariable {
  key: string;
  value: string;
  isSecret: boolean;
}

export interface Environment {
  id: string;
  projectId: string;
  organizationId: string;
  name: 'development' | 'staging' | 'production' | string;
  slug: string;
  type: 'development' | 'staging' | 'production';
  isProtected: boolean;
  variables: EnvironmentVariable[];
  description: string;
  createdAt: string;
  updatedAt: string;
}

