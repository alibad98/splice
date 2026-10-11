export const en = {
  app: { name: 'Slips', logoAlt: 'Slips' },
  shell: {
    skipToContent: 'Skip to content',
    primaryNav: 'Main navigation',
    openMenu: 'Open menu',
    closeMenu: 'Close menu',
    menuTitle: 'Menu',
    storeIdentity: 'Store',
    storeFallback: 'Your store',
    previewStore: 'Preview store',
    previewUnavailable: 'Connect your store to preview it',
    needHelp: 'Need help? Contact support',
    language: 'Language',
    switchTo: 'العربية',
    switchToLabel: 'Switch to Arabic',
    nav: {
      overview: 'Overview',
      content: 'Videos & Stories',
      products: 'Products',
      analytics: 'Analytics',
      settings: 'Settings',
    },
    connection: {
      connected: 'Connected to Salla',
      notConnected: 'Not connected to Salla',
      hintNotConnected: 'Connect your store to start',
    },
  },
  home: {
    title: 'Welcome to Slips',
    intro: 'Turn your product videos into Stories that sell. Start by connecting your store.',
    nextStep: 'Connect your store',
    apiHealth: 'API health',
    apiUnreachable: 'unreachable',
  },
  placeholder: {
    title: 'Coming soon',
    body: 'This page is being built. Head back to the overview for your next step.',
    back: 'Back to overview',
  },
} as const;

type Widen<T> = T extends string ? string : { [K in keyof T]: Widen<T[K]> };
export type Messages = Widen<typeof en>;
