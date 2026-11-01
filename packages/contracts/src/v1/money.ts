// Money convention (spine): integer minor units with the ISO 4217 exponent, plus the currency code.

/** ISO 4217 minor-unit exponents for the currencies Slips stores can price in. Add a code before accepting it. */
export const CURRENCY_EXPONENTS: Readonly<Record<string, number>> = {
  SAR: 2,
  AED: 2,
  QAR: 2,
  EGP: 2,
  MAD: 2,
  YER: 2,
  USD: 2,
  EUR: 2,
  GBP: 2,
  KWD: 3,
  BHD: 3,
  OMR: 3,
  JOD: 3,
  IQD: 3,
  LYD: 3,
  TND: 3,
  JPY: 0,
};

export class UnknownCurrencyError extends Error {
  constructor(readonly currency: string) {
    super(`unknown currency ${currency}`);
    this.name = 'UnknownCurrencyError';
  }
}

export class InvalidAmountError extends Error {
  constructor() {
    super('amount is not a finite decimal');
    this.name = 'InvalidAmountError';
  }
}

export function currencyExponent(currency: string): number {
  const exp = CURRENCY_EXPONENTS[currency.toUpperCase()];
  if (exp === undefined) throw new UnknownCurrencyError(currency);
  return exp;
}

/**
 * Convert a decimal major-unit amount ("12.50", 12.5) to integer minor units for `currency`, without float
 * arithmetic. Extra fraction digits round half away from zero. Throws on an unknown currency or a non-decimal.
 */
export function toMinorUnits(amount: string | number, currency: string): number {
  const exp = currencyExponent(currency);
  let text: string;
  if (typeof amount === 'number') {
    if (!Number.isFinite(amount)) throw new InvalidAmountError();
    text = /e/i.test(String(amount)) ? amount.toFixed(exp + 1) : String(amount);
  } else {
    text = amount.trim();
  }
  const m = /^(-?)(\d+)(?:\.(\d+))?$/.exec(text);
  if (!m) throw new InvalidAmountError();
  const [, sign, whole, frac = ''] = m;
  const kept = frac.slice(0, exp).padEnd(exp, '0');
  let minor = BigInt(whole! + kept);
  if (frac.length > exp && Number(frac[exp]) >= 5) minor += 1n;
  if (minor > BigInt(Number.MAX_SAFE_INTEGER)) throw new InvalidAmountError();
  const n = Number(minor);
  return sign === '-' && n !== 0 ? -n : n;
}
