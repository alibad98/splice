import { SetMetadata } from '@nestjs/common';

export const PUBLIC_ROUTE = 'slips:public-route';

/** Marks a route that needs no session (health, metrics, the OAuth redirect legs, sign-in itself). Every other route requires a merchant session. */
export const Public = (): MethodDecorator & ClassDecorator => SetMetadata(PUBLIC_ROUTE, true);
