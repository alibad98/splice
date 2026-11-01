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

const escapeHtml = (s: string): string => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

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

  /** Dev-only consent simulator, served only when the dev platform stands in for unconfigured Salla credentials. */
  @Get('mock-consent')
  mockConsent(@Query('state') rawState: unknown, @Res() res: Response): void {
    if (!this.config.devConsent) {
      res.status(404).send();
      return;
    }
    if (typeof rawState !== 'string' || !rawState) {
      res.status(400).send('Missing state');
      return;
    }
    const state = escapeHtml(rawState);
    const cancelHref = escapeHtml(new URL('/login', this.config.dashboardUrl).toString());
    const html = `<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
  <meta charset="UTF-8">
  <title>محاكي ربط سلة | Salla Auth Simulator</title>
  <style>
    body { font-family: system-ui, -apple-system, sans-serif; background: #FAF8F6; color: #15110F; display: flex; align-items: center; justify-content: center; min-height: 100vh; margin: 0; padding: 20px; }
    .card { background: #fff; border-radius: 16px; border: 1px solid #ECE8E4; box-shadow: 0 8px 24px -14px rgba(40,24,16,.16); padding: 32px; max-width: 440px; width: 100%; text-align: center; }
    .badge { display: inline-block; background: #004956; color: #B9F280; font-size: 12px; font-weight: bold; padding: 4px 12px; border-radius: 999px; margin-bottom: 16px; }
    h1 { font-size: 20px; margin: 0 0 8px; }
    p { font-size: 14px; color: #615954; margin: 0 0 24px; line-height: 1.5; }
    .field { text-align: start; margin-bottom: 16px; }
    label { display: block; font-size: 12px; font-weight: 600; margin-bottom: 6px; }
    input { width: 100%; box-sizing: border-box; height: 42px; border: 1px solid #8F8681; border-radius: 10px; padding: 0 12px; font-size: 14px; }
    .btn { display: block; width: 100%; height: 44px; background: #004956; color: #fff; border: none; border-radius: 12px; font-size: 14px; font-weight: 600; cursor: pointer; margin-top: 24px; }
    .btn:hover { background: #003842; }
    .cancel { display: block; margin-top: 12px; font-size: 13px; color: #615954; text-decoration: none; }
  </style>
</head>
<body>
  <div class="card">
    <div class="badge">Salla Dev Simulator</div>
    <h1>تفويض تطبيق Slips على متجرك</h1>
    <p>أنت في بيئة التطوير المحلي. يمكنك إتمام الربط كمتجر تجريبي لاختبار تدفق تسجيل الدخول وتعيين كلمة المرور عبر OTP.</p>
    <form method="GET" action="/v1/integrations/salla/callback">
      <input type="hidden" name="state" value="${state}" />
      <div class="field">
        <label>البريد الإلكتروني لمالك المتجر (Owner Email)</label>
        <input type="email" id="emailInput" value="merchant@example.com" required />
      </div>
      <div class="field">
        <label>معرّف المتجر التجريبي (Store ID)</label>
        <input type="text" id="storeInput" value="1001" required />
      </div>
      <input type="hidden" name="code" id="codeInput" value="" />
      <button type="submit" class="btn" onclick="document.getElementById('codeInput').value = 'mock_code_' + encodeURIComponent(document.getElementById('emailInput').value) + '_' + encodeURIComponent(document.getElementById('storeInput').value)">
        موافقة وتفويض التطبيق
      </button>
      <a href="${cancelHref}" class="cancel">إلغاء والعودة</a>
    </form>
  </div>
</body>
</html>`;
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(html);
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
      // The owner's password invite, if any, was sent by the install itself (owner-invite listener).
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

