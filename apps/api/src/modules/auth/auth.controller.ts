import { Body, Controller, ForbiddenException, Get, HttpCode, HttpException, Inject, Post, Req, Res, ServiceUnavailableException, UnauthorizedException } from '@nestjs/common';
import type { SessionInfo } from '@slips/contracts';
import type { Response } from 'express';
import { z } from 'zod';
import { Public } from '../session/public.decorator.js';
import type { AuthenticatedRequest } from '../session/access.guard.js';
import { SessionService } from '../session/session.service.js';
import { AuthService } from './auth.service.js';

const EmbeddedBody = z.object({ token: z.string().min(1).max(4096) });

const REINSTALL_MESSAGE = 'Slips is not installed on this store. Reinstall the app from the Salla App Store to continue.';

@Controller('v1/session')
export class AuthController {
  constructor(
    @Inject(AuthService) private readonly auth: AuthService,
    @Inject(SessionService) private readonly sessions: SessionService,
  ) {}

  /** Embedded sign-in: trade the host-issued token for a short-lived bearer the dashboard keeps in memory. */
  @Public()
  @Post('embedded')
  @HttpCode(200)
  async embedded(@Body() body: unknown, @Res({ passthrough: true }) res: Response) {
    const parsed = EmbeddedBody.safeParse(body);
    if (!parsed.success) throw new HttpException({ message: 'A token is required', code: 'invalid_token' }, 400);
    res.setHeader('Cache-Control', 'no-store');
    const result = await this.auth.signInEmbedded(parsed.data.token);
    if (result.ok) return result.session;
    switch (result.reason) {
      case 'invalid_token':
        throw new UnauthorizedException({ message: 'The sign-in token is not valid. Reload the page from your Salla dashboard.', code: 'invalid_token' });
      case 'store_not_installed':
        throw new ForbiddenException({ message: REINSTALL_MESSAGE, code: 'store_not_installed' });
      case 'platform_unavailable':
        throw new ServiceUnavailableException({ message: 'Salla could not be reached. Try again in a moment.', code: 'platform_unavailable' });
    }
  }

  /** The signed-in merchant, the connection status for the shell chip, and (cookie sessions) the CSRF token. */
  @Get()
  async current(@Req() req: AuthenticatedRequest): Promise<SessionInfo> {
    return (await this.auth.describe(req.merchantSession!)).info;
  }

  /** Sign out: ends the session at once, in either mode. */
  @Post('sign-out')
  @HttpCode(204)
  async signOut(@Req() req: AuthenticatedRequest, @Res({ passthrough: true }) res: Response): Promise<void> {
    await this.sessions.revoke(req.merchantSession!);
    if (req.sessionSource === 'cookie') res.setHeader('Set-Cookie', this.sessions.clearedCookie());
    res.setHeader('Cache-Control', 'no-store');
  }
}
