import { Controller, ForbiddenException, Get, HttpCode, Post } from '@nestjs/common';
import { Public } from '../session/public.decorator.js';

/**
 * Slips Admin API (AD-12). The sign-in provider is deferred (Epic 7): sign-in denies by default, and the guard
 * (AccessGuard, `/v1/admin/**`) refuses every request until a provider implements the AdminAccess port.
 * Merchant sessions never reach these handlers.
 */
@Controller('v1/admin')
export class AdminController {
  /** Stub: no admin identity provider exists yet, so nobody can sign in. */
  @Public()
  @Post('sign-in')
  @HttpCode(403)
  signIn(): never {
    throw new ForbiddenException({ message: 'Admin sign-in is not available', code: 'admin_forbidden' });
  }

  /** Guarded placeholder: proves the admin guard is in front of the admin surface. */
  @Get('session')
  session(): { admin: true } {
    return { admin: true };
  }
}
