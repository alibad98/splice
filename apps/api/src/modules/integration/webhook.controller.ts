import { Controller, HttpCode, Inject, Post, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import { Public } from '../session/public.decorator.js';
import { IntegrationService } from './integration.service.js';

/**
 * Salla webhook endpoint (AD-13). Public by design: the signature over the raw body is the only credential. The body
 * is never logged and never echoed; the answer is 200 for anything accepted (including duplicates), 401 for a bad
 * signature, 400 for a signed body that is not a recognisable event. Events for stores we do not know yet are accepted
 * and parked by the inbox, never answered 404.
 */
@Public()
@Controller('v1/webhooks')
export class WebhookController {
  constructor(@Inject(IntegrationService) private readonly service: IntegrationService) {}

  @Post('salla')
  @HttpCode(200)
  async salla(@Req() req: Request & { rawBody?: Buffer }, @Res() res: Response): Promise<void> {
    res.setHeader('Cache-Control', 'no-store');
    const rawBody = req.rawBody;
    if (!rawBody) {
      res.status(401).type('application/problem+json').send({ type: 'about:blank', title: 'Invalid webhook signature', status: 401 });
      return;
    }
    const result = await this.service.inbox.receiveAndProcess({ headers: req.headers, rawBody });
    if (result.status === 401) res.status(401).type('application/problem+json').send({ type: 'about:blank', title: 'Invalid webhook signature', status: 401 });
    else if (result.status === 400) res.status(400).type('application/problem+json').send({ type: 'about:blank', title: 'Unrecognised webhook event', status: 400 });
    else res.status(200).json({ ok: true });
  }
}
