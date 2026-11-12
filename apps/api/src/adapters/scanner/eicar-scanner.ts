import type { MalwareScanner, ScanResult } from '../../ports/malware-scanner.js';

/** The EICAR anti-malware test string (a harmless, industry-standard test signature). */
export const EICAR_TEST_STRING = String.raw`X5O!P%@AP[4\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*`;

/**
 * Development scanner: flags any file containing the EICAR test string, anywhere in its bytes. It detects no real
 * malware; production needs a real scanner adapter (deferred, vendor not chosen).
 */
export class EicarMalwareScanner implements MalwareScanner {
  private readonly needle = Buffer.from(EICAR_TEST_STRING, 'latin1');

  async scan(bytes: Buffer): Promise<ScanResult> {
    return bytes.includes(this.needle) ? { infected: true, signature: 'EICAR-Test-File' } : { infected: false };
  }
}
