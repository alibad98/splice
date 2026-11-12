import { Controller, Get, Inject, Param, Res, ServiceUnavailableException } from '@nestjs/common';
import type { Response } from 'express';
import { StoreManifest } from '@slips/contracts';
import { OBJECT_STORAGE, type ObjectStorage } from '../../ports/object-storage.js';
import { TELEMETRY, Metric, type Telemetry } from '../../ports/telemetry.js';
import { Public } from '../session/public.decorator.js';
import { emptyManifest, MANIFEST_CACHE_CONTROL, manifestKey } from './manifest-delivery.js';

/** Object-only origin. No tenant locator, commerce calls or database reads on shopper requests. */
@Public()
@Controller('m/v1/salla')
export class ManifestController {
  constructor(@Inject(OBJECT_STORAGE) private readonly storage: ObjectStorage, @Inject(TELEMETRY) private readonly telemetry: Telemetry) {}

  @Get(':platformStoreId.json')
  async read(@Param('platformStoreId') platformStoreId: string, @Res({ passthrough: true }) res: Response): Promise<StoreManifest> {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.removeHeader('Access-Control-Allow-Credentials');
    try {
      const stream = await this.storage.getStream(manifestKey(platformStoreId));
      if (!stream) {
        res.setHeader('Cache-Control', MANIFEST_CACHE_CONTROL);
        return emptyManifest();
      }
      const chunks: Buffer[] = [];
      for await (const chunk of stream) chunks.push(Buffer.from(chunk as Buffer));
      const manifest = StoreManifest.parse(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      res.setHeader('Cache-Control', MANIFEST_CACHE_CONTROL);
      return manifest;
    } catch {
      res.setHeader('Cache-Control', 'no-store');
      this.telemetry.counter(Metric.ManifestOriginFailures);
      throw new ServiceUnavailableException('Manifest origin unavailable');
    }
  }
}
