export interface ApiKey {
    id: string;
    organizationId: string;
    userId: string;
    name: string;
    keyPrefix: string;
    scopes: string[];
    expiresAt: string | null;
    lastUsedAt: string | null;
    isActive: boolean;
    createdAt: string;
    updatedAt: string;
}
export interface ApiKeyCreatedResponse {
    apiKey: ApiKey;
    plainTextKey: string;
}
//# sourceMappingURL=api-key.types.d.ts.map