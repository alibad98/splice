import { describe, expect, it } from 'vitest';
import { EICAR_TEST_STRING, EicarMalwareScanner } from './eicar-scanner.js';

describe('EicarMalwareScanner', () => {
  it('uses the exact 68-byte EICAR test string', () => {
    expect(EICAR_TEST_STRING).toHaveLength(68);
    expect(EICAR_TEST_STRING.slice(0, 13)).toBe('X5O!P%@AP[4\\P');
  });

  it('flags the test string anywhere in a file and passes other files', async () => {
    const scanner = new EicarMalwareScanner();
    const wrapped = Buffer.concat([Buffer.from([0xff, 0xd8, 0x00]), Buffer.from(EICAR_TEST_STRING, 'latin1'), Buffer.from('tail')]);
    expect(await scanner.scan(wrapped)).toEqual({ infected: true, signature: 'EICAR-Test-File' });
    expect(await scanner.scan(Buffer.from('a clean file'))).toEqual({ infected: false });
  });
});
