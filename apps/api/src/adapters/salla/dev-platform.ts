import type {
  CanonicalOrder,
  CanonicalProduct,
  CanonicalSubscription,
  CanonicalWebhook,
  CommercePlatform,
  EmbeddedIdentity,
  MerchantProfile,
  PlatformSession,
  TokenSet,
} from '../../ports/commerce-platform.js';

export class DevSallaCommercePlatform implements CommercePlatform {
  readonly platform = 'salla' as const;

  readonly auth = {
    buildAuthorizeUrl: (state: string): string => {
      return `/v1/integrations/salla/mock-consent?state=${encodeURIComponent(state)}`;
    },

    exchangeCode: async (code: string): Promise<TokenSet> => {
      return {
        accessToken: `dev_at_${code}`,
        refreshToken: `dev_rt_${code}`,
        expiresAt: new Date(Date.now() + 3600 * 1000),
        scopes: ['offline_access', 'read:products', 'read:orders'],
      };
    },

    refresh: async (refreshToken: string): Promise<TokenSet> => {
      return {
        accessToken: `dev_at_refreshed_${refreshToken}`,
        refreshToken: `dev_rt_refreshed_${refreshToken}`,
        expiresAt: new Date(Date.now() + 3600 * 1000),
        scopes: ['offline_access', 'read:products', 'read:orders'],
      };
    },

    getMerchantProfile: async (accessToken: string): Promise<MerchantProfile> => {
      let ownerEmail = 'merchant@example.com';
      let platformStoreId = '1001';

      if (accessToken.includes('mock_code_')) {
        const parts = accessToken.split('mock_code_')[1]?.split('_') ?? [];
        if (parts[0]) {
          try {
            ownerEmail = decodeURIComponent(parts[0]);
          } catch {
            // fallback
          }
        }
        if (parts[1]) {
          try {
            platformStoreId = decodeURIComponent(parts[1]);
          } catch {
            // fallback
          }
        }
      }

      return {
        platformStoreId,
        storeName: `Demo Store ${platformStoreId}`,
        platformMerchantId: '99',
        ownerName: 'Demo Merchant',
        ownerEmail,
        domains: ['demo-store.salla.sa'],
      };
    },
  };

  readonly embedded = {
    introspect: async (): Promise<EmbeddedIdentity> => ({
      platformStoreId: '1001',
      platformUserId: '99',
      expiresAt: new Date(Date.now() + 3600 * 1000),
    }),
    openUrl: (): string | undefined => undefined,
  };

  readonly products = {
    list: async (): Promise<{ items: CanonicalProduct[]; hasMore: boolean }> => ({
      items: [],
      hasMore: false,
    }),
  };

  readonly orders = {
    get: async (_: PlatformSession, externalId: string): Promise<CanonicalOrder> => ({
      externalId,
      status: 'completed',
      total: 100,
      currency: 'SAR',
      lines: [],
    }),
  };

  readonly subscriptions = {
    list: async (): Promise<CanonicalSubscription[]> => [],
  };

  readonly webhooks = {
    verify: (): boolean => true,
    parse: (): CanonicalWebhook | null => null,
  };
}
