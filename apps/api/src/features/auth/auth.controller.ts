import type { Request, Response } from 'express';
import { asyncWrapper } from '../../lib/async-wrapper';
import type { AuthService } from './auth.service';
import { registerSchema, loginSchema, passwordChangeSchema } from './auth.schema';
import { config } from '../../config';
import { UnauthorizedError } from '../../lib/errors';

export class AuthController {
  constructor(private readonly authService: AuthService) {}

  private setRefreshTokenCookie(res: Response, token: string): void {
    res.cookie('refreshToken', token, {
      httpOnly: true,
      secure: config.server.isProduction, // True in production, false in development
      sameSite: 'strict',
      maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
      path: '/api/v1/auth', // Scoped to auth routes to prevent leakage
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
    const { accessToken, refreshToken, user } = await this.authService.login(dto);

    this.setRefreshTokenCookie(res, refreshToken);

    res.status(200).json({
      success: true,
      data: {
        accessToken,
        user,
      },
    });
  });

  refresh = asyncWrapper(async (req: Request, res: Response): Promise<void> => {
    // Read from cookie first, fallback to body
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
      await this.authService.logout(token);
    }

    this.clearRefreshTokenCookie(res);

    res.status(204).end();
  });

  changePassword = asyncWrapper(async (req: Request, res: Response): Promise<void> => {
    const dto = passwordChangeSchema.parse(req.body);
    const userId = (req as any).user.id;

    await this.authService.changePassword(userId, dto);

    // After password change, logout of all other devices, and clear current session cookie
    this.clearRefreshTokenCookie(res);

    res.status(200).json({
      success: true,
      message: 'Password changed successfully. Active sessions revoked.',
    });
  });
}
