import { Body, Controller, HttpCode, HttpException, Inject, Post, Res } from '@nestjs/common';
import type { Response } from 'express';
import { ForgotPasswordInput, LoginInput, ResendOtpInput, ResetPasswordInput, SelectStoreInput, SetPasswordInput, VerifyOtpInput } from '@slips/contracts';
import { Public } from '../session/public.decorator.js';
import { AuthService } from './auth.service.js';
import { CredentialsService, type SignInOutcome } from './credentials.service.js';

@Public()
@Controller('v1/auth')
export class CredentialsController {
  constructor(
    @Inject(CredentialsService) private readonly credentials: CredentialsService,
    @Inject(AuthService) private readonly auth: AuthService,
  ) {}

  /** Signed in: set the session cookie. Several stores: hand back the choice and a short-lived selection token. */
  private async respond(outcome: SignInOutcome, res: Response) {
    if (outcome.kind === 'select') return { ok: true, select_store: { selection_token: outcome.selectionToken, stores: outcome.stores } };
    res.setHeader('Set-Cookie', outcome.cookie);
    const { info } = await this.auth.describe(outcome.session);
    return { ok: true, session: info };
  }

  @Post('login')
  @HttpCode(200)
  async login(@Body() body: unknown, @Res({ passthrough: true }) res: Response) {
    const parsed = LoginInput.safeParse(body);
    if (!parsed.success) {
      throw new HttpException({ message: 'Invalid credentials format', code: 'invalid_credentials' }, 400);
    }
    res.setHeader('Cache-Control', 'no-store');
    return this.respond(await this.credentials.login(parsed.data), res);
  }

  /** Second step for an owner of several stores: open the chosen one. */
  @Post('login/select')
  @HttpCode(200)
  async selectStore(@Body() body: unknown, @Res({ passthrough: true }) res: Response) {
    const parsed = SelectStoreInput.safeParse(body);
    if (!parsed.success) {
      throw new HttpException({ message: 'Invalid store selection', code: 'invalid_token' }, 400);
    }
    res.setHeader('Cache-Control', 'no-store');
    return this.respond(await this.credentials.selectStore(parsed.data), res);
  }

  @Post('forgot-password')
  @HttpCode(200)
  async forgotPassword(@Body() body: unknown, @Res({ passthrough: true }) res: Response) {
    const parsed = ForgotPasswordInput.safeParse(body);
    if (!parsed.success) {
      throw new HttpException({ message: 'Valid email is required', code: 'invalid_email' }, 400);
    }
    res.setHeader('Cache-Control', 'no-store');
    return this.credentials.forgotPassword(parsed.data.email);
  }

  @Post('verify-otp')
  @HttpCode(200)
  async verifyOtp(@Body() body: unknown, @Res({ passthrough: true }) res: Response) {
    const parsed = VerifyOtpInput.safeParse(body);
    if (!parsed.success) {
      throw new HttpException({ message: 'Invalid code or payload', code: 'invalid_otp' }, 400);
    }
    res.setHeader('Cache-Control', 'no-store');
    return this.credentials.verifyOtp(parsed.data);
  }

  @Post('reset-password')
  @HttpCode(200)
  async resetPassword(@Body() body: unknown, @Res({ passthrough: true }) res: Response) {
    const parsed = ResetPasswordInput.safeParse(body);
    if (!parsed.success) {
      throw new HttpException({ message: 'Valid password (min 8 characters) is required', code: 'invalid_password' }, 400);
    }
    res.setHeader('Cache-Control', 'no-store');
    return this.credentials.resetPassword(parsed.data);
  }

  @Post('set-password')
  @HttpCode(200)
  async setPassword(@Body() body: unknown, @Res({ passthrough: true }) res: Response) {
    const parsed = SetPasswordInput.safeParse(body);
    if (!parsed.success) {
      throw new HttpException({ message: 'Valid password (min 8 characters) is required', code: 'invalid_password' }, 400);
    }
    res.setHeader('Cache-Control', 'no-store');
    return this.respond(await this.credentials.setPassword(parsed.data), res);
  }

  @Post('resend-otp')
  @HttpCode(200)
  async resendOtp(@Body() body: unknown, @Res({ passthrough: true }) res: Response) {
    const parsed = ResendOtpInput.safeParse(body);
    if (!parsed.success) {
      throw new HttpException({ message: 'Invalid payload', code: 'invalid_payload' }, 400);
    }
    res.setHeader('Cache-Control', 'no-store');
    return this.credentials.resendOtp(parsed.data.email, parsed.data.purpose);
  }
}
