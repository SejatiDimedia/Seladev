export interface Secret {
  id: string;
  environmentId: string;
  projectId: string;
  organizationId: string;
  key: string;
  value: string; // Plaintext when retrieved by authorized users, masked or omitted otherwise
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
