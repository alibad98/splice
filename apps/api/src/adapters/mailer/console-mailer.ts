import type { Mailer, OtpEmailPayload } from '../../ports/mailer.js';
import type { Telemetry } from '../../ports/telemetry.js';

export class ConsoleMailer implements Mailer {
  constructor(private readonly telemetry: Telemetry) {}

  async sendOtp(payload: OtpEmailPayload): Promise<void> {
    this.telemetry.log.info(
      `[DEV MAILER] Sent ${payload.purpose} OTP code to ${payload.to}`,
      { email: payload.to, purpose: payload.purpose },
    );
    console.log(`\n========================================`);
    console.log(`📧 [EMAIL OTP] To: ${payload.to}`);
    console.log(`🔑 Purpose: ${payload.purpose.toUpperCase()}`);
    console.log(`🔢 Code: [ ${payload.code} ] (valid until ${payload.expiresAt.toISOString()})`);
    if (payload.link) console.log(`🔗 ${payload.link}`);
    console.log(`========================================\n`);
  }
}
