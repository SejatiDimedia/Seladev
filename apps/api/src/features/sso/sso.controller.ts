import type { Request, Response } from 'express';
import { asyncWrapper } from '../../lib/async-wrapper';
import type { SsoService } from './sso.service';
import { z } from 'zod';
import { ValidationError } from '../../lib/errors';

const CLIENT_URL = process.env.CLIENT_URL || 'http://localhost:3000';

const createSsoConfigSchema = z.object({
  provider: z.enum(['saml', 'oidc']),
  samlEntryPoint: z.string().url('SAML entryPoint must be a valid URL').optional(),
  samlIssuer: z.string().optional(),
  samlCert: z.string().optional(),
  oidcClientId: z.string().optional(),
  oidcClientSecret: z.string().optional(),
  oidcIssuer: z.string().url('OIDC issuer must be a valid URL').optional(),
});

const updateSsoConfigSchema = createSsoConfigSchema.extend({
  isActive: z.boolean().optional(),
}).partial();

export class SsoController {
  constructor(private readonly ssoService: SsoService) {}

  // 1. Discover SSO
  discoverSso = asyncWrapper(async (req: Request, res: Response): Promise<void> => {
    const identifier = (req.query.identifier as string || req.body.identifier as string);
    if (!identifier) {
      throw new ValidationError([], 'Email or organization slug is required');
    }

    const result = await this.ssoService.discoverSso(identifier);
    res.status(200).json({
      success: true,
      data: result,
    });
  });

  // 2. Initiate SAML Login
  initiateSamlLogin = asyncWrapper(async (req: Request, res: Response): Promise<void> => {
    const { orgId } = req.params;
    if (!orgId) {
      res.status(400).json({ success: false, message: 'Organization ID is required' });
      return;
    }

    const redirectUrl = await this.ssoService.initiateSamlLogin(orgId);
    res.redirect(redirectUrl);
  });

  // 3. Handle SAML Callback (HTTP-POST)
  handleSamlCallback = asyncWrapper(async (req: Request, res: Response): Promise<void> => {
    const { orgId } = req.params;
    const { SAMLResponse } = req.body;
    if (!orgId || !SAMLResponse) {
      res.status(400).json({ success: false, message: 'Organization ID and SAMLResponse are required' });
      return;
    }

    const clientContext = {
      ipAddress: req.ip || null,
      userAgent: req.headers['user-agent'] || null,
    };

    const result = await this.ssoService.handleSamlCallback(orgId, SAMLResponse, clientContext);

    // Redirect to frontend callback page with tokens in query params
    res.redirect(
      `${CLIENT_URL}/sso/callback?accessToken=${encodeURIComponent(
        result.accessToken
      )}&refreshToken=${encodeURIComponent(result.refreshToken)}`
    );
  });

  // 4. Initiate OIDC Login
  initiateOidcLogin = asyncWrapper(async (req: Request, res: Response): Promise<void> => {
    const { orgId } = req.params;
    if (!orgId) {
      res.status(400).json({ success: false, message: 'Organization ID is required' });
      return;
    }

    const redirectUrl = await this.ssoService.initiateOidcLogin(orgId);
    res.redirect(redirectUrl);
  });

  // 5. Handle OIDC Callback
  handleOidcCallback = asyncWrapper(async (req: Request, res: Response): Promise<void> => {
    const { code, state, error, error_description } = req.query;

    if (error) {
      res.redirect(
        `${CLIENT_URL}/login?error=${encodeURIComponent(
          (error_description || error) as string
        )}`
      );
      return;
    }

    if (!code || !state) {
      res.status(400).json({ success: false, message: 'Authorization code and state are required' });
      return;
    }

    const clientContext = {
      ipAddress: req.ip || null,
      userAgent: req.headers['user-agent'] || null,
    };

    const result = await this.ssoService.handleOidcCallback(code as string, state as string, clientContext);

    // Redirect to frontend callback page with tokens
    res.redirect(
      `${CLIENT_URL}/sso/callback?accessToken=${encodeURIComponent(
        result.accessToken
      )}&refreshToken=${encodeURIComponent(result.refreshToken)}`
    );
  });

  // 6. Get SP Metadata
  getSamlSpMetadata = asyncWrapper(async (req: Request, res: Response): Promise<void> => {
    const { orgId } = req.params;
    if (!orgId) {
      res.status(400).json({ success: false, message: 'Organization ID is required' });
      return;
    }

    const xml = await this.ssoService.getSamlSpMetadata(orgId);
    res.set('Content-Type', 'text/xml');
    res.send(xml);
  });

  // 7. Admin CRUD Configuration
  createSsoConfig = asyncWrapper(async (req: Request, res: Response): Promise<void> => {
    const { orgId } = req.params;
    if (!orgId) {
      res.status(400).json({ success: false, message: 'Organization ID is required' });
      return;
    }
    const userId = (req as any).user.id;
    const dto = createSsoConfigSchema.parse(req.body);

    const result = await this.ssoService.createSsoConfig(orgId, userId, dto);

    res.status(201).json({
      success: true,
      data: result,
    });
  });

  getSsoConfig = asyncWrapper(async (req: Request, res: Response): Promise<void> => {
    const { orgId } = req.params;
    if (!orgId) {
      res.status(400).json({ success: false, message: 'Organization ID is required' });
      return;
    }

    const result = await this.ssoService.getSsoConfig(orgId);

    res.status(200).json({
      success: true,
      data: result,
    });
  });

  updateSsoConfig = asyncWrapper(async (req: Request, res: Response): Promise<void> => {
    const { orgId } = req.params;
    if (!orgId) {
      res.status(400).json({ success: false, message: 'Organization ID is required' });
      return;
    }
    const userId = (req as any).user.id;
    const dto = updateSsoConfigSchema.parse(req.body);

    const result = await this.ssoService.updateSsoConfig(orgId, userId, dto);

    res.status(200).json({
      success: true,
      data: result,
    });
  });

  deleteSsoConfig = asyncWrapper(async (req: Request, res: Response): Promise<void> => {
    const { orgId } = req.params;
    if (!orgId) {
      res.status(400).json({ success: false, message: 'Organization ID is required' });
      return;
    }
    const userId = (req as any).user.id;

    await this.ssoService.deleteSsoConfig(orgId, userId);

    res.status(200).json({
      success: true,
      message: 'SSO configuration deleted successfully',
    });
  });
}
