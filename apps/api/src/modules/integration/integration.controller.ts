import { Controller, Get, Inject, Query, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import { INTEGRATION_CONFIG, type IntegrationConfig } from '../../infra.module.js';
import { PlatformUnavailableError } from '../../ports/commerce-platform.js';
import { Public } from '../session/public.decorator.js';
import { SESSION_COOKIE, SessionService } from '../session/session.service.js';
import { STATE_TTL_MS } from './install-state.js';
import { IntegrationService } from './integration.service.js';

const COOKIE = 'slips_oauth_state';
const COOKIE_PATH = '/v1/integrations/salla';

function cookieValue(header: string | undefined, name: string): string | undefined {
  for (const part of (header ?? '').split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === name) return v.join('=') || undefined;
  }
  return undefined;
}

@Public()
@Controller('v1/integrations/salla')
export class IntegrationController {
  constructor(
    @Inject(IntegrationService) private readonly service: IntegrationService,
    @Inject(INTEGRATION_CONFIG) private readonly config: IntegrationConfig,
    @Inject(SessionService) private readonly sessions: SessionService,
  ) {}

  /** Begin installation: set the state-binding cookie and send the merchant to Salla's consent screen. */
  @Get('install')
  install(@Res() res: Response): void {
    let begun;
    try {
      begun = this.service.beginInstall();
    } catch (err) {
      if (err instanceof PlatformUnavailableError) {
        res.status(503).type('application/problem+json').send({ type: 'about:blank', title: 'Salla integration is not configured', status: 503 });
        return;
      }
      throw err;
    }
    const secure = this.config.secureCookies ? '; Secure' : '';
    res.setHeader('Set-Cookie', `${COOKIE}=${begun.nonce}; HttpOnly; SameSite=Lax; Path=${COOKIE_PATH}; Max-Age=${STATE_TTL_MS / 1000}${secure}`);
    res.setHeader('Cache-Control', 'no-store');
    res.redirect(302, begun.redirectUrl);
  }

  /** OAuth redirect target; on success it also signs the merchant in with a first-party cookie session. Always ends in a redirect to the dashboard; the query (code, state) is never logged. */
  @Get('callback')
  async callback(@Query('code') code: string | undefined, @Query('state') state: string | undefined, @Query('error') error: string | undefined, @Req() req: Request, @Res() res: Response): Promise<void> {
    const result = await this.service.completeInstall({
      ...(typeof code === 'string' ? { code } : {}),
      ...(typeof state === 'string' ? { state } : {}),
      ...(typeof error === 'string' ? { error } : {}),
      ...(cookieValue(req.headers.cookie, COOKIE) ? { cookieNonce: cookieValue(req.headers.cookie, COOKIE)! } : {}),
    });
    const target = new URL('/', this.config.dashboardUrl);
    if (result.ok) target.searchParams.set('connected', '1');
    else target.searchParams.set('install_error', result.reason);
    const cookies = [`${COOKIE}=; HttpOnly; SameSite=Lax; Path=${COOKIE_PATH}; Max-Age=0`];
    if (result.ok) {
      // The merchant just proved control of the store with Salla OAuth: that is the direct-link sign-in (AD-12).
      try {
        const previous = cookieValue(req.headers.cookie, SESSION_COOKIE);
        if (previous) await this.sessions.revokeCredential(previous);
        cookies.push(this.sessions.cookieFor((await this.sessions.create(result.storeId, 'direct')).token));
      } catch {
        target.searchParams.delete('connected');
        target.searchParams.set('install_error', 'internal');
      }
    }
    res.setHeader('Set-Cookie', cookies);
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.redirect(302, target.toString());
  }
}
