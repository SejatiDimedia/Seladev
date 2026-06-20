import type { Request, Response } from 'express';
import { asyncWrapper } from '../../lib/async-wrapper';
import type { AuthService } from './auth.service';
import { registerSchema, loginSchema, passwordChangeSchema, verifyMfaSchema, loginMfaSchema } from './auth.schema';
import { config } from '../../config';
import { UnauthorizedError } from '../../lib/errors';

export class AuthController {
  constructor(private readonly authService: AuthService) {}

  private setRefreshTokenCookie(res: Response, token: string): void {
    res.cookie('refreshToken', token, {
      httpOnly: true,
      secure: config.server.isProduction,
      sameSite: 'strict',
      maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
      path: '/api/v1/auth',
    });
  }

  private clearRefreshTokenCookie(res: Response): void {
    res.clearCookie('refreshToken', {
      httpOnly: true,
      secure: config.server.isProduction,
      sameSite: 'strict',
      path: '/api/v1/auth',
    });
  }

  private getClientContext(req: Request) {
    return {
      ipAddress: req.ip || null,
      userAgent: (req.headers['user-agent'] as string) || null,
    };
  }

  register = asyncWrapper(async (req: Request, res: Response): Promise<void> => {
    const dto = registerSchema.parse(req.body);
    const user = await this.authService.register(dto);
    res.status(201).json({
      success: true,
      data: user,
    });
  });

  login = asyncWrapper(async (req: Request, res: Response): Promise<void> => {
    const dto = loginSchema.parse(req.body);
    const result = await this.authService.login(dto, this.getClientContext(req));

    if (result.requiresMfa) {
      res.status(200).json({
        success: true,
        data: {
          requiresMfa: true,
          mfaToken: result.mfaToken,
          user: result.user,
        },
      });
      return;
    }

    this.setRefreshTokenCookie(res, result.refreshToken);

    res.status(200).json({
      success: true,
      data: {
        requiresMfa: false,
        accessToken: result.accessToken,
        user: result.user,
      },
    });
  });

  refresh = asyncWrapper(async (req: Request, res: Response): Promise<void> => {
    const token = req.cookies?.refreshToken || req.body.refreshToken;
    if (!token) {
      throw new UnauthorizedError('Refresh token required', 'AUTH_REQUIRED');
    }

    const { accessToken, refreshToken, user } = await this.authService.refresh(token);

    this.setRefreshTokenCookie(res, refreshToken);

    res.status(200).json({
      success: true,
      data: {
        accessToken,
        user,
      },
    });
  });

  logout = asyncWrapper(async (req: Request, res: Response): Promise<void> => {
    const token = req.cookies?.refreshToken || req.body.refreshToken;
    if (token) {
      await this.authService.logout(token, this.getClientContext(req));
    }

    this.clearRefreshTokenCookie(res);

    res.status(204).end();
  });

  changePassword = asyncWrapper(async (req: Request, res: Response): Promise<void> => {
    const dto = passwordChangeSchema.parse(req.body);
    const userId = (req as any).user.id;

    await this.authService.changePassword(userId, dto, this.getClientContext(req));

    this.clearRefreshTokenCookie(res);

    res.status(200).json({
      success: true,
      message: 'Password changed successfully. Active sessions revoked.',
    });
  });

  verifyLoginMfa = asyncWrapper(async (req: Request, res: Response): Promise<void> => {
    const dto = loginMfaSchema.parse(req.body);
    const { accessToken, refreshToken, user } = await this.authService.verifyLoginMfa(
      dto.mfaToken,
      dto.token,
      this.getClientContext(req)
    );

    this.setRefreshTokenCookie(res, refreshToken);

    res.status(200).json({
      success: true,
      data: {
        accessToken,
        user,
      },
    });
  });

  setupMfa = asyncWrapper(async (req: Request, res: Response): Promise<void> => {
    const userId = (req as any).user.id;
    const { secret, qrCodeUrl } = await this.authService.setupMfa(userId);

    res.status(200).json({
      success: true,
      data: {
        secret,
        qrCodeUrl,
      },
    });
  });

  activateMfa = asyncWrapper(async (req: Request, res: Response): Promise<void> => {
    const dto = verifyMfaSchema.parse(req.body);
    const userId = (req as any).user.id;
    const { recoveryCodes } = await this.authService.activateMfa(userId, dto.token, this.getClientContext(req));

    res.status(200).json({
      success: true,
      data: {
        recoveryCodes,
      },
    });
  });

  disableMfa = asyncWrapper(async (req: Request, res: Response): Promise<void> => {
    const dto = verifyMfaSchema.parse(req.body);
    const userId = (req as any).user.id;
    await this.authService.disableMfa(userId, dto.token, this.getClientContext(req));

    res.status(200).json({
      success: true,
      message: 'MFA has been successfully disabled.',
    });
  });
}
