/**
 * MinaDental V16 — Monetary Precision & Localized Digit Normalization
 * Trace ID: TRC-MINA-V16-FINANCE-9018-Q
 *
 * Canonical Currency Contract: `IRR_TOMAN` (integer Toman; zero floating-point math).
 * Supports Persian (۰-۹), Eastern Arabic (٠-٩), and ASCII (0-9) digits while
 * strictly rejecting fractions/decimals, negative/zero amounts, scientific notation,
 * or non-numeric garbage.
 */

export const CURRENCY_CONTRACT = 'IRR_TOMAN' as const;
export type CurrencyContract = typeof CURRENCY_CONTRACT;

export type AmountParseErrorCode =
  | 'EMPTY'
  | 'INVALID_FORMAT'
  | 'NON_INTEGER_FRACTION'
  | 'NEGATIVE_OR_ZERO'
  | 'UNSAFE_OVERFLOW';

export type ExactTomanParseResult =
  | {
      ok: true;
      amount: number;
      normalizedText: string;
      currency: CurrencyContract;
    }
  | {
      ok: false;
      errorCode: AmountParseErrorCode;
      messageFa: string;
    };

const PERSIAN_DIGITS = '۰۱۲۳۴۵۶۷۸۹';
const ARABIC_DIGITS = '٠١٢٣٤٥٦٧٨٩';

/**
 * Normalizes Persian/Arabic numerals and safe thousand separators to canonical ASCII digits.
 * Preserves decimal markers (`.` / `٫`), sign markers (`-` / `+` / `−`), and unexpected
 * characters so downstream validation can explicitly reject fractions or malformed input.
 */
export function normalizeLocalizedDigits(raw: string | number | null | undefined): string {
  if (raw === null || raw === undefined) return '';
  const str = String(raw).trim();
  if (!str) return '';

  let mapped = '';
  for (const ch of str) {
    const pIdx = PERSIAN_DIGITS.indexOf(ch);
    if (pIdx >= 0) {
      mapped += String(pIdx);
      continue;
    }
    const aIdx = ARABIC_DIGITS.indexOf(ch);
    if (aIdx >= 0) {
      mapped += String(aIdx);
      continue;
    }
    if (ch === '٫') {
      mapped += '.';
      continue;
    }
    if (ch === '−') {
      mapped += '-';
      continue;
    }
    // Strip standard thousand separators (ASCII comma, Arabic thousands separator ٬, underscore, spaces, ZWNJ)
    if (ch === ',' || ch === '٬' || ch === '_' || ch === ' ' || ch === '\u200c' || ch === '\u00a0') {
      continue;
    }
    mapped += ch;
  }

  // Strip optional trailing Persian currency labels only if separated or trailing cleanly
  return mapped.replace(/(تومان|ت)$/u, '').trim();
}

/**
 * Strictly parses an exact integer Toman monetary amount.
 */
export function parseExactTomanAmount(
  raw: string | number | null | undefined,
  options: { allowZero?: boolean; maxAmount?: number } = {}
): ExactTomanParseResult {
  const allowZero = options.allowZero === true;
  const maxAmount = options.maxAmount ?? Number.MAX_SAFE_INTEGER;

  if (typeof raw === 'number') {
    if (!Number.isFinite(raw)) {
      return {
        ok: false,
        errorCode: 'INVALID_FORMAT',
        messageFa: 'مبلغ واردشده معتبر نیست.',
      };
    }
    if (!Number.isInteger(raw)) {
      return {
        ok: false,
        errorCode: 'NON_INTEGER_FRACTION',
        messageFa: 'مبلغ باید عدد صحیح به تومان باشد و اعشار مجاز نیست.',
      };
    }
    if (raw < 0 || (!allowZero && raw === 0)) {
      return {
        ok: false,
        errorCode: 'NEGATIVE_OR_ZERO',
        messageFa: allowZero ? 'مبلغ نمی‌تواند منفی باشد.' : 'مبلغ باید بزرگ‌تر از صفر باشد.',
      };
    }
    if (raw > maxAmount || raw > Number.MAX_SAFE_INTEGER) {
      return {
        ok: false,
        errorCode: 'UNSAFE_OVERFLOW',
        messageFa: 'مبلغ از سقف مجاز محاسباتی بیشتر است.',
      };
    }
    return {
      ok: true,
      amount: raw,
      normalizedText: String(raw),
      currency: CURRENCY_CONTRACT,
    };
  }

  const normalized = normalizeLocalizedDigits(raw);
  if (!normalized) {
    return {
      ok: false,
      errorCode: 'EMPTY',
      messageFa: 'لطفاً مبلغ را وارد کنید.',
    };
  }

  if (/^[+-]?\d+\.\d*$/.test(normalized) || /^\.\d+$/.test(normalized)) {
    return {
      ok: false,
      errorCode: 'NON_INTEGER_FRACTION',
      messageFa: 'مبلغ باید عدد صحیح به تومان باشد و اعشار مجاز نیست.',
    };
  }

  if (/^-\d+$/.test(normalized)) {
    return {
      ok: false,
      errorCode: 'NEGATIVE_OR_ZERO',
      messageFa: allowZero ? 'مبلغ نمی‌تواند منفی باشد.' : 'مبلغ منفی مجاز نیست.',
    };
  }

  const cleanPositive = normalized.startsWith('+') ? normalized.slice(1) : normalized;
  if (!/^\d+$/.test(cleanPositive)) {
    return {
      ok: false,
      errorCode: 'INVALID_FORMAT',
      messageFa: 'فرمت مبلغ نامعتبر است؛ فقط ارقام صحیح مجاز است.',
    };
  }

  const num = Number(cleanPositive);
  if (!Number.isSafeInteger(num) || num > maxAmount) {
    return {
      ok: false,
      errorCode: 'UNSAFE_OVERFLOW',
      messageFa: 'مبلغ واردشده خارج از محدوده مجاز صحیح است.',
    };
  }

  if (!allowZero && num === 0) {
    return {
      ok: false,
      errorCode: 'NEGATIVE_OR_ZERO',
      messageFa: 'مبلغ باید بزرگ‌تر از صفر باشد.',
    };
  }

  return {
    ok: true,
    amount: num,
    normalizedText: String(num),
    currency: CURRENCY_CONTRACT,
  };
}

export function formatToman(amount: number | null | undefined): string {
  const safe = Number.isFinite(Number(amount)) ? Math.round(Number(amount)) : 0;
  return safe.toLocaleString('fa-IR');
}

/**
 * Exact Toman -> Rial conversion using BigInt (zero floating point drift).
 */
export function convertTomanToRialExact(toman: number): string {
  if (!Number.isSafeInteger(toman)) {
    throw new Error('MINA_FIN_NON_INTEGER_CONVERSION: Toman amount must be a safe integer');
  }
  return (BigInt(toman) * 10n).toString();
}
