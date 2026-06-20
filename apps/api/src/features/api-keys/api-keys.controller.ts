import type { Request, Response } from 'express';
import { asyncWrapper } from '../../lib/async-wrapper';
import type { ApiKeysService } from './api-keys.service';
import { createApiKeySchema, updateApiKeySchema } from './api-keys.schema';

export class ApiKeysController {
  constructor(private readonly apiKeysService: ApiKeysService) {}

  private getClientContext(req: Request) {
    return {
      ipAddress: req.ip || null,
      userAgent: (req.headers['user-agent'] as string) || null,
    };
  }

  createKey = asyncWrapper(async (req: Request, res: Response): Promise<void> => {
    const orgIdOrSlug = req.params.orgIdOrSlug!;
    const dto = createApiKeySchema.parse(req.body);
    const user = (req as any).user;

    const { apiKey, plainTextKey } = await this.apiKeysService.createKey(user, orgIdOrSlug, dto, this.getClientContext(req));

    res.status(201).json({
      success: true,
      data: {
        ...apiKey.toJSON(),
        plainTextKey,
      },
    });
  });

  listKeys = asyncWrapper(async (req: Request, res: Response): Promise<void> => {
    const orgIdOrSlug = req.params.orgIdOrSlug!;
    const user = (req as any).user;
    const keys = await this.apiKeysService.listKeys(user, orgIdOrSlug);

    res.status(200).json({
      success: true,
      data: keys.map(k => k.toJSON()),
    });
  });

  getKeyMetadata = asyncWrapper(async (req: Request, res: Response): Promise<void> => {
    const keyId = req.params.keyId!;
    const user = (req as any).user;
    const apiKey = await this.apiKeysService.getKeyMetadata(user, keyId);

    res.status(200).json({
      success: true,
      data: apiKey.toJSON(),
    });
  });

  updateKey = asyncWrapper(async (req: Request, res: Response): Promise<void> => {
    const keyId = req.params.keyId!;
    const dto = updateApiKeySchema.parse(req.body);
    const user = (req as any).user;
    const apiKey = await this.apiKeysService.updateKey(user, keyId, dto, this.getClientContext(req));

    res.status(200).json({
      success: true,
      data: apiKey.toJSON(),
    });
  });

  deleteKey = asyncWrapper(async (req: Request, res: Response): Promise<void> => {
    const keyId = req.params.keyId!;
    const user = (req as any).user;
    await this.apiKeysService.deleteKey(user, keyId, this.getClientContext(req));

    res.status(204).end();
  });
}
