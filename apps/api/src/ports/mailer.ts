export interface OtpEmailPayload {
  to: string;
  code: string;
  purpose: 'setup' | 'reset';
  expiresAt: Date;
  /** Where the merchant enters the code (the setup invite is read outside any browser session). */
  link?: string;
  storeName?: string;
}

export interface Mailer {
  sendOtp(payload: OtpEmailPayload): Promise<void>;
}

export const MAILER = Symbol('Mailer');
