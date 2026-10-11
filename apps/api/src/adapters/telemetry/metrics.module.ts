import { Controller, Get, Headers, Inject, Module, NotFoundException, UnauthorizedException, Header } from '@nestjs/common';
import { METRICS_ENDPOINT, type MetricsEndpoint } from '../../infra.module.js';
import { Public } from '../../modules/session/public.decorator.js';
import { isAuthorizedForMetrics } from './http.js';

/** `GET /metrics`: Prometheus text exposition, disabled (404) unless METRICS_TOKEN is set. */
@Public()
@Controller('metrics')
export class MetricsController {
  constructor(@Inject(METRICS_ENDPOINT) private readonly metrics: MetricsEndpoint) {}

  @Get()
  @Header('content-type', 'text/plain; version=0.0.4; charset=utf-8')
  get(@Headers('authorization') authorization: string | undefined): string {
    if (!this.metrics.token) throw new NotFoundException();
    if (!isAuthorizedForMetrics(authorization, this.metrics.token)) throw new UnauthorizedException();
    return this.metrics.render();
  }
}

@Module({ controllers: [MetricsController] })
export class MetricsModule {}
