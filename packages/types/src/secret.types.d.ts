export interface Secret {
    id: string;
    environmentId: string;
    projectId: string;
    organizationId: string;
    key: string;
    value: string;
    version: number;
    isLocked: boolean;
    createdBy: string;
    createdAt: string;
    updatedAt: string;
}
export interface EncryptedField {
    ciphertext: string;
    iv: string;
    authTag: string;
}
//# sourceMappingURL=secret.types.d.ts.map