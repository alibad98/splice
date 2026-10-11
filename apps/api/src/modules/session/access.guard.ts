import type { CanActivate, ExecutionContext } from '@nestjs/common';
import { ForbiddenException, Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request, Response } from 'express';
import { ADMIN_ACCESS, type AdminAccess } from '../../ports/admin-access.js';
import { PUBLIC_ROUTE } from './public.decorator.js';
import { SESSION_COOKIE, SessionService, type MerchantSession } from './session.service.js';

export type SessionSource = 'bearer' | 'cookie';
export interface AuthenticatedRequest extends Request {
  merchantSession?: MerchantSession;
  sessionSource?: SessionSource;
}

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);
export const ADMIN_PREFIX = '/v1/admin';

const header = (req: Request, name: string): string | undefined => {
  const v = req.headers[name];
  return Array.isArray(v) ? v[0] : v;
};

function cookieValue(raw: string | undefined, name: string): string | undefined {
  for (const part of (raw ?? '').split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === name) return v.join('=') || undefined;
  }
  return undefined;
}

/**
 * Global access control (AD-12). Admin routes (`/v1/admin/**`) go only to the admin provider, which today denies
 * everyone; a merchant session never opens them. Every other route needs a merchant session unless marked `@Public()`:
 * an embedded bearer (`Authorization`) or a direct-link cookie; cookie sessions must also present the CSRF token on
 * state-changing requests.
 */
@Injectable()
export class AccessGuard implements CanActivate {
  constructor(
    @Inject(Reflector) private readonly reflector: Reflector,
    @Inject(SessionService) private readonly sessions: SessionService,
    @Inject(ADMIN_ACCESS) private readonly admin: AdminAccess,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (context.getType() !== 'http') return true;
    const http = context.switchToHttp();
    const req = http.getRequest<AuthenticatedRequest>();
    const isPublic = this.reflector.getAllAndOverride<boolean>(PUBLIC_ROUTE, [context.getHandler(), context.getClass()]);

    const path = req.path.toLowerCase();
    if (path === ADMIN_PREFIX || path.startsWith(`${ADMIN_PREFIX}/`)) {
      if (isPublic) return true; // the admin sign-in stub; it denies on its own
      const principal = await this.admin.authenticate({ headers: req.headers });
      if (!principal) throw new ForbiddenException({ message: 'Admin access is required', code: 'admin_forbidden' });
      return true;
    }
    if (isPublic) return true;

    const res = http.getResponse<Response>();
    const authorization = header(req, 'authorization');
    const bearer = /^Bearer (\S+)$/.exec(authorization ?? '')?.[1];
    const cookie = bearer ? undefined : cookieValue(header(req, 'cookie'), SESSION_COOKIE);
    const credential = bearer ?? cookie;
    if (!credential) throw new UnauthorizedException({ message: 'Sign in to continue', code: 'session_required' });

    const source: SessionSource = bearer ? 'bearer' : 'cookie';
    const outcome = await this.sessions.authenticate(credential, source === 'bearer' ? 'embedded' : 'direct');
    if (outcome.kind !== 'ok') {
      if (source === 'cookie') res.setHeader('Set-Cookie', this.sessions.clearedCookie());
      throw new UnauthorizedException(
        outcome.kind === 'expired' ? { message: 'Your session ended. Sign in again to continue', code: 'session_expired' } : { message: 'Sign in to continue', code: 'session_required' },
      );
    }
    if (source === 'cookie' && !SAFE_METHODS.has(req.method.toUpperCase()) && !this.sessions.isValidCsrf(outcome.session.id, header(req, 'x-csrf-token'))) {
      throw new ForbiddenException({ message: 'The request could not be verified', code: 'csrf_invalid' });
    }
    req.merchantSession = outcome.session;
    req.sessionSource = source;
    res.setHeader('Cache-Control', 'no-store');
    return true;
  }
}
