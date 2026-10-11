import { PlatformUnavailableError, type CommercePlatform } from '../../ports/commerce-platform.js';

export { SallaCommercePlatform, type SallaConfig } from './salla-platform.js';

/** Stand-in when Salla credentials are not configured (local dev, tests): every call fails closed and says why. */
export function unconfiguredPlatform(): CommercePlatform {
  const fail = (): never => {
    throw new PlatformUnavailableError('Salla is not configured (set SALLA_CLIENT_ID, SALLA_CLIENT_SECRET and SALLA_REDIRECT_URI)');
  };
  return {
    platform: 'salla',
    auth: { buildAuthorizeUrl: fail, exchangeCode: fail, refresh: fail, getMerchantProfile: fail },
    products: { list: fail },
    orders: { get: fail },
    subscriptions: { list: fail },
    webhooks: { verify: () => false },
  };
}
